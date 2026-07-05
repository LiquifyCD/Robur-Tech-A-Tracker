/**
 * app.js
 * ---------------------------------------------------------------------------
 * Orchestrates the whole app: loads holdings, polls market data on a timer,
 * runs the calculation, and pushes results to ui.js. This is the only
 * module that should import all the others - it wires them together but
 * contains no fetching/math/DOM logic of its own beyond scheduling.
 *
 * Refresh behaviour (per spec):
 *   - Poll every 15s while the market is open AND the tab is visible.
 *   - Pause immediately on visibilitychange -> hidden, resume on visible.
 *   - On repeated failures, back off exponentially (30s, 60s, 120s...,
 *     capped at 5 min) rather than hammering a struggling API.
 * ---------------------------------------------------------------------------
 */

import { getHoldings, scheduleBackgroundRefresh } from './holdings.js';
import { getQuotes, isMarketOpen } from './marketData.js';
import { getRates } from './exchangeRates.js';
import { computeFundEstimate, computeEstimatedValue } from './calculator.js';
import * as ui from './ui.js';

const REFRESH_INTERVAL_MS = 15 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

// Placeholder last-official-NAV. In a future iteration this should come
// from its own small server-side fetch (the same factsheet endpoint
// exposes it) - kept simple here since NAV updates once/day and isn't
// the focus of this iteration.
const FALLBACK_LAST_NAV_SEK = 1882.71;

let state = {
  holdingsPayload: null,
  consecutiveFailures: 0,
  pollTimer: null,
  isPolling: false,
};

async function refreshCycle() {
  if (!state.holdingsPayload) return;
  const holdings = state.holdingsPayload.holdings;
  const tickers = holdings.map((h) => h.ticker);

  try {
    const { quotes, allStale } = await getQuotes(tickers);
    const usedCurrencies = Object.values(quotes)
      .map((q) => q.currency)
      .filter(Boolean);
    const { rates, stale: ratesStale } = await getRates(usedCurrencies);

    const result = computeFundEstimate(holdings, quotes, rates);
    const estimatedValue = computeEstimatedValue(FALLBACK_LAST_NAV_SEK, result.estimatedChangePct);

    ui.renderEstimate({
      estimatedChangePct: result.estimatedChangePct,
      estimatedValue,
      lastNav: FALLBACK_LAST_NAV_SEK,
      coveragePct: result.coveragePct,
    });
    ui.renderGainersLosers(result);
    ui.addChartPoint(result.estimatedChangePct);
    ui.renderChart();
    ui.renderMarketStatus(isMarketOpen(quotes));
    ui.renderLastUpdate(new Date());
    ui.renderLiveIndicator(true);

    if (allStale || ratesStale) {
      ui.showErrorBanner('Livedata är tillfälligt otillgänglig - visar senaste tillgängliga uppskattning.');
      state.consecutiveFailures += 1;
    } else {
      ui.hideErrorBanner();
      state.consecutiveFailures = 0;
    }
  } catch (err) {
    console.error('[app] refresh cycle failed', err);
    ui.showErrorBanner('Livedata är tillfälligt otillgänglig - visar senaste tillgängliga uppskattning.');
    ui.renderLiveIndicator(false);
    state.consecutiveFailures += 1;
  }

  scheduleNextRefresh();
}

function currentIntervalMs() {
  if (state.consecutiveFailures === 0) return REFRESH_INTERVAL_MS;
  const backoff = REFRESH_INTERVAL_MS * 2 ** state.consecutiveFailures;
  return Math.min(backoff, MAX_BACKOFF_MS);
}

function scheduleNextRefresh() {
  clearTimeout(state.pollTimer);
  if (!state.isPolling) return;
  state.pollTimer = setTimeout(refreshCycle, currentIntervalMs());
}

function startPolling() {
  if (state.isPolling) return;
  state.isPolling = true;
  ui.renderLiveIndicator(true);
  refreshCycle(); // fire immediately, then the timer takes over
}

function stopPolling() {
  state.isPolling = false;
  clearTimeout(state.pollTimer);
  ui.renderLiveIndicator(false);
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopPolling();
  } else {
    startPolling();
  }
}

async function init() {
  ui.setLoading(true);

  const { payload, stale, error } = await getHoldings();
  state.holdingsPayload = payload;
  ui.renderHoldingsMeta({ asOfDate: payload.asOfDate, source: payload.source, stale });
  if (stale && error) {
    ui.showErrorBanner(`Kunde inte hämta senaste innehav (${error}). Använder cachad data.`);
  }

  ui.setLoading(false);

  if (!document.hidden) {
    startPolling();
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);

  scheduleBackgroundRefresh((result) => {
    state.holdingsPayload = result.payload;
    ui.renderHoldingsMeta({ asOfDate: result.payload.asOfDate, source: result.payload.source, stale: result.stale });
  });
}

document.addEventListener('DOMContentLoaded', init);
