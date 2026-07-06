/**
 * calculator.js
 * ---------------------------------------------------------------------------
 * Pure, side-effect-free math for turning (holdings + quotes + fx rates)
 * into a fund-level performance estimate. Kept separate from
 * marketData/holdings/ui so it's trivially testable and reusable if a
 * second fund is ever added.
 * ---------------------------------------------------------------------------
 */

import { toSEK } from './exchangeRates.js';

/**
 * @typedef {object} HoldingContribution
 * @property {string} name
 * @property {string} ticker
 * @property {number} weightPct - normalized weight used in the calculation
 * @property {number|null} changePct - the stock's own daily % change
 * @property {number|null} contributionPct - changePct * weight, i.e. this
 *   holding's share of the fund-level estimate
 * @property {boolean} stale - true if this holding's quote could not be
 *   refreshed this round and we're using a cached value
 * @property {boolean} missing - true if we have no quote for this holding
 *   at all (excluded from the weighted average)
 */

/**
 * @param {Array} holdings - normalized holdings from holdings.js
 * @param {Object<string, object>} quotes - symbol -> quote from marketData.js
 * @param {Object<string, number>} rates - currency -> SEK rate from exchangeRates.js
 * @returns {{
 *   estimatedChangePct: number,
 *   coveragePct: number,
 *   contributions: HoldingContribution[],
 *   gainers: HoldingContribution[],
 *   losers: HoldingContribution[]
 * }}
 */
export function computeFundEstimate(holdings, quotes, rates) {
  const contributions = holdings.map((h) => {
    const quote = quotes[h.ticker];
    if (!quote || quote.price == null || quote.previousClose == null) {
      return {
        name: h.name,
        ticker: h.ticker,
        weightPct: h.normalizedWeightPct,
        changePct: null,
        contributionPct: null,
        stale: Boolean(quote && quote.stale),
        missing: true,
      };
    }

    // Currency conversion cancels out in a same-currency % change
    // (both price and previousClose scale identically), so it only
    // matters if a holding's currency differs AND we want an absolute
    // SEK value rather than a %. We still convert here for correctness
    // and so calculator.js is ready to support absolute-value display
    // in the future (see "Future Features" - historical performance).
    const priceSek = toSEK(quote.price, quote.currency, rates);
    const prevCloseSek = toSEK(quote.previousClose, quote.currency, rates);
    const changePct = ((priceSek - prevCloseSek) / prevCloseSek) * 100;

    return {
      name: h.name,
      ticker: h.ticker,
      weightPct: h.normalizedWeightPct,
      changePct,
      contributionPct: (changePct * h.normalizedWeightPct) / 100,
      stale: Boolean(quote.stale),
      missing: false,
    };
  });

  const usable = contributions.filter((c) => !c.missing);
  const usableWeight = usable.reduce((sum, c) => sum + c.weightPct, 0);

  // Re-scale by the weight we actually have data for, so a single missing
  // quote doesn't silently drag the estimate toward zero. See
  // computeWeightedAverage() below for the actual math.
  const estimate = computeWeightedAverage(usable, usableWeight);

  const sorted = [...usable].sort((a, b) => b.changePct - a.changePct);

  return {
    estimatedChangePct: estimate,
    coveragePct: usableWeight,
    contributions,
    gainers: sorted.slice(0, 5),
    losers: sorted.slice(-5).reverse(),
  };
}

/**
 * Straightforward weighted average, isolated into its own function for
 * clarity and testability: sum(changePct * weight) / sum(weight).
 */
function computeWeightedAverage(usableContributions, usableWeight) {
  if (usableWeight === 0) return 0;
  const weightedSum = usableContributions.reduce((sum, c) => sum + c.changePct * c.weightPct, 0);
  return weightedSum / usableWeight;
}

/**
 * Estimated current fund value in SEK, given the last official NAV and
 * the estimated % change since that NAV was struck.
 * @param {number} lastNav
 * @param {number} estimatedChangePct
 */
export function computeEstimatedValue(lastNav, estimatedChangePct) {
  return lastNav * (1 + estimatedChangePct / 100);
}
