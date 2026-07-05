/**
 * exchangeRates.js
 * ---------------------------------------------------------------------------
 * Retrieves currency conversion rates (USD/SEK, EUR/SEK, TWD/SEK, etc.)
 * needed to convert each holding's local-currency return into SEK, which is
 * the fund's base currency.
 *
 * Rates are fetched through our own /api/fx Cloudflare Pages Function
 * (which proxies the free Frankfurter API) rather than calling a third
 * party directly from the browser, so we can cache and control CORS.
 *
 * FX rates move far more slowly than intraday stock prices, so a 1 hour
 * cache is generous and keeps API usage minimal.
 * ---------------------------------------------------------------------------
 */

import { cache } from './cache.js';

const CACHE_KEY = 'fxRates';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const BASE_CURRENCY = 'SEK'; // The fund's reporting currency

/**
 * Fetch the latest rates for a set of currencies, expressed as
 * "1 unit of currency X = N SEK". Falls back to cached (possibly stale)
 * rates if the network request fails, since a slightly outdated FX rate
 * is far better than none for an estimate tool.
 *
 * @param {string[]} currencies - e.g. ['USD', 'EUR', 'TWD']
 * @returns {Promise<{rates: Object<string, number>, asOf: string, stale: boolean}>}
 */
export async function getRates(currencies) {
  const uniqueCurrencies = Array.from(new Set(currencies.filter((c) => c && c !== BASE_CURRENCY)));

  const cached = cache.get(CACHE_KEY);
  if (cached && !cached.stale && uniqueCurrencies.every((c) => c in cached.value.rates)) {
    return { ...cached.value, stale: false };
  }

  try {
    const params = new URLSearchParams({
      base: BASE_CURRENCY,
      symbols: uniqueCurrencies.join(','),
    });
    const res = await fetch(`/api/fx?${params.toString()}`);
    if (!res.ok) throw new Error(`FX request failed: ${res.status}`);
    const data = await res.json();

    // data.rates is "1 SEK = N currency" (Frankfurter's base convention),
    // we invert it so callers can do localAmount * rates[CUR] = SEK amount.
    const inverted = {};
    for (const [cur, rateFromSek] of Object.entries(data.rates)) {
      inverted[cur] = 1 / rateFromSek;
    }
    inverted[BASE_CURRENCY] = 1;

    const payload = { rates: inverted, asOf: data.date || new Date().toISOString() };
    cache.set(CACHE_KEY, payload, CACHE_TTL_MS);
    return { ...payload, stale: false };
  } catch (err) {
    console.warn('[exchangeRates] live fetch failed, falling back to cache', err);
    const stale = cache.get(CACHE_KEY, { allowStale: true });
    if (stale) return { ...stale.value, stale: true };

    // Absolute last resort: rough static approximations so the app never
    // hard-crashes on first load with no network. Clearly marked as stale.
    return {
      rates: { USD: 9.6, EUR: 11.2, TWD: 0.3, SEK: 1 },
      asOf: null,
      stale: true,
    };
  }
}

/**
 * Convert an amount from one currency to SEK.
 * @param {number} amount
 * @param {string} currency
 * @param {Object<string, number>} rates - as returned by getRates()
 */
export function toSEK(amount, currency, rates) {
  const rate = rates[currency];
  if (!rate) {
    console.warn(`[exchangeRates] Missing rate for ${currency}, assuming 1:1`);
    return amount;
  }
  return amount * rate;
}

export const BASE = BASE_CURRENCY;
