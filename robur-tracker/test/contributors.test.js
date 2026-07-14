import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContributionSummary,
  calculateContribution,
  calculateCurrencyAdjustedChange,
  normaliseWeightPct,
  parseDailyQuote,
  parseHoldings,
  parseQuoteSinceNav,
} from '../functions/api/contributors.js';
import { deriveIntradayEstimate } from '../public/js/intradayEstimate.js';

test('weights normalize from decimal fractions or percentages', () => {
  assert.equal(normaliseWeightPct(0.1), 10);
  assert.equal(normaliseWeightPct(10), 10);
  assert.equal(normaliseWeightPct(0.083064005, '8.31%'), 8.31);
  assert.equal(normaliseWeightPct(1), 100);
  assert.equal(normaliseWeightPct(-1), null);
  assert.equal(normaliseWeightPct(101), null);
});

test('contribution uses percentage points and matches the documented example', () => {
  assert.equal(calculateContribution(4, 10), 0.4);
  assert.equal(calculateContribution(-2, 5), -0.1);
  assert.equal(calculateContribution(null, 5), null);
});

test('holdings parser preserves names, tickers, and normalized weights', () => {
  const holdings = parseHoldings({
    quoteSummary: {
      result: [{ topHoldings: { holdings: [
        { symbol: 'AAA', holdingName: 'Alpha', holdingPercent: { raw: 0.1, fmt: '10.00%' } },
        { symbol: 'BBB', holdingName: 'Beta', holdingPercent: { raw: 5, fmt: '5.00%' } },
      ] } }],
    },
  });
  assert.deepEqual(holdings, [
    { ticker: 'AAA', name: 'Alpha', weightPct: 10 },
    { ticker: 'BBB', name: 'Beta', weightPct: 5 },
  ]);
});

test('daily quote uses current price and previous close with freshness metadata', () => {
  const quote = parseDailyQuote({
    meta: {
      symbol: 'AAA',
      regularMarketPrice: 104,
      previousClose: 100,
      regularMarketTime: 1_700_000_000,
      currency: 'USD',
      marketState: 'REGULAR',
    },
    indicators: { quote: [{ close: [100, 104] }] },
  }, 'AAA', 1_700_010_000_000);
  assert.equal(quote.dayChangePct, 4);
  assert.equal(quote.stale, false);
  assert.equal(quote.currency, 'USD');
});

test('quote change is aligned to the latest NAV date rather than only previous close', () => {
  const quote = parseQuoteSinceNav({
    meta: {
      symbol: 'AAA',
      regularMarketPrice: 106,
      regularMarketTime: 1_752_165_600,
      currency: 'USD',
    },
    timestamp: [1_752_002_400, 1_752_088_800, 1_752_165_600],
    indicators: { quote: [{ close: [100, 103, 106] }] },
  }, 'AAA', '2025-07-08T00:00:00.000Z', 1_752_168_000_000);
  assert.equal(quote.baselinePrice, 100);
  assert.equal(quote.dayChangePct, 6);
  assert.equal(quote.baselineAsOf.slice(0, 10), '2025-07-08');
});

test('foreign-currency returns compound asset and FX changes', () => {
  assert.ok(Math.abs(calculateCurrencyAdjustedChange(10, -5) - 4.5) < 1e-12);
  const holdings = [
    { ticker: 'USD', name: 'US holding', weightPct: 20 },
    { ticker: 'SEK', name: 'Swedish holding', weightPct: 10 },
  ];
  const quotes = new Map([
    ['USD', { quote: { dayChangePct: 10, currency: 'USD', asOf: '2026-07-10T10:00:00Z', stale: false } }],
    ['SEK', { quote: { dayChangePct: -2, currency: 'SEK', asOf: '2026-07-10T10:00:00Z', stale: false } }],
  ]);
  const fx = new Map([
    ['USDSEK=X', { quote: { dayChangePct: -5, asOf: '2026-07-10T10:00:00Z', stale: false } }],
  ]);
  const result = buildContributionSummary(holdings, quotes, { fundCurrency: 'SEK' }, fx);
  assert.ok(Math.abs(result.winners[0].dayChangePct - 4.5) < 1e-12);
  assert.ok(Math.abs(result.summary.netPctPoints - 0.7) < 1e-12);
  assert.equal(result.summary.currencyAdjustedCount, 1);
  assert.equal(result.summary.calculatedCoveragePct, 30);
  assert.equal(result.summary.scaledToFullPortfolio, false);
});

test('stale prices and missing FX stay visible but are excluded from the estimate', () => {
  const holdings = [
    { ticker: 'STALE', name: 'Stale', weightPct: 12 },
    { ticker: 'NOFX', name: 'No FX', weightPct: 8 },
  ];
  const quotes = new Map([
    ['STALE', { quote: { dayChangePct: 3, currency: 'SEK', asOf: '2026-06-01T10:00:00Z', stale: true } }],
    ['NOFX', { quote: { dayChangePct: 4, currency: 'USD', asOf: '2026-07-10T10:00:00Z', stale: false } }],
  ]);
  const result = buildContributionSummary(holdings, quotes, { fundCurrency: 'SEK' });
  assert.equal(result.summary.availableCount, 0);
  assert.equal(result.summary.calculatedCoveragePct, 0);
  assert.equal(result.summary.netPctPoints, 0);
  assert.deepEqual(result.unavailable.map((item) => item.status), ['stale', 'missing-fx']);
});

test('partial estimate is not scaled and remains distinct from official NAV change', () => {
  const estimate = deriveIntradayEstimate({
    netPctPoints: 0.3,
    calculatedCoveragePct: 39,
    availableCount: 3,
    isPartial: true,
  }, 1.8);
  assert.equal(estimate.estimatedChangePct, 0.3);
  assert.equal(estimate.officialNavChangePct, 1.8);
  assert.equal(estimate.coveragePct, 39);
  assert.equal(estimate.isPartial, true);
  assert.equal(estimate.scaledToFullPortfolio, false);
});

test('summary sorts by actual fund contribution and preserves missing holdings', () => {
  const holdings = [
    { ticker: 'BIG', name: 'Big mover', weightPct: 4 },
    { ticker: 'HEAVY', name: 'Heavy holding', weightPct: 20 },
    { ticker: 'LOSS', name: 'Loser', weightPct: 10 },
    { ticker: 'MISS', name: 'Missing quote', weightPct: 5 },
  ];
  const quotes = new Map([
    ['BIG', { quote: { dayChangePct: 5, resolvedSymbol: 'BIG', asOf: '2026-07-10T10:00:00Z', stale: false } }],
    ['HEAVY', { quote: { dayChangePct: 2, resolvedSymbol: 'HEAVY', asOf: '2026-07-10T10:00:00Z', stale: false } }],
    ['LOSS', { quote: { dayChangePct: -3, resolvedSymbol: 'LOSS', asOf: '2026-07-10T10:00:00Z', stale: false } }],
    ['MISS', { reason: 'Provider missing' }],
  ]);

  const result = buildContributionSummary(holdings, quotes);
  assert.deepEqual(result.winners.map((item) => item.ticker), ['HEAVY', 'BIG']);
  assert.deepEqual(result.losers.map((item) => item.ticker), ['LOSS']);
  assert.equal(result.summary.positivePctPoints, 0.6);
  assert.ok(Math.abs(result.summary.negativePctPoints + 0.3) < 1e-12);
  assert.ok(Math.abs(result.summary.netPctPoints - 0.3) < 1e-12);
  assert.equal(result.summary.disclosedCoveragePct, 39);
  assert.equal(result.summary.calculatedCoveragePct, 34);
  assert.equal(result.unavailable.length, 1);
  assert.equal(result.unavailable[0].reason, 'Provider missing');
});
