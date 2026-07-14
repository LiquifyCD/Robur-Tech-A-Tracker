import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContributionSummary,
  calculateContribution,
  calculateCurrencyAdjustedChange,
  dedupeHoldings,
  isHoldingsStale,
  normaliseWeightPct,
  parseDailyQuote,
  parseHoldings,
  parseRoburHoldings,
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

test('official holdings preserve percentage weights and include disclosed cash without inventing a quote', () => {
  const holdings = parseRoburHoldings({
    holdings: [
      { name: 'Broadcom Inc', weight: 7.5, country: 'US' },
      { name: 'Space Exploration Technologies Corp', weight: 0.24, country: 'US' },
    ],
    sectors: [{ sector_SE: 'Kassa & Övrigt', weight: 0.8 }],
  });
  assert.deepEqual(holdings, [
    { name: 'Broadcom Inc', ticker: 'AVGO', weightPct: 7.5, kind: 'equity', country: 'US' },
    { name: 'Space Exploration Technologies Corp', ticker: null, weightPct: 0.24, kind: 'equity', country: 'US' },
    { name: 'Kassa och övrigt', ticker: 'CASH:SEK', weightPct: 0.8, kind: 'cash', currency: 'SEK', country: null },
  ]);
  const result = buildContributionSummary(holdings, new Map([
    ['AVGO', { quote: { dayChangePct: 1, currency: 'SEK', asOf: '2026-07-10T10:00:00Z', stale: false } }],
    ['space exploration technologies corp', { reason: 'Ingen noterad kurs.' }],
    ['CASH:SEK', { reason: 'Kassa och övrigt kan inte prissättas separat.' }],
  ]), { fundCurrency: 'SEK' });
  assert.equal(result.summary.disclosedCoveragePct, 8.54);
  assert.equal(result.summary.calculatedCoveragePct, 7.5);
  assert.deepEqual(result.unavailable.map((item) => item.kind), ['equity', 'cash']);
});

test('duplicate holdings do not inflate disclosed coverage', () => {
  const holdings = dedupeHoldings([
    { ticker: 'AAA', name: 'Alpha', weightPct: 10 },
    { ticker: 'AAA', name: 'Alpha duplicate', weightPct: 10 },
    { ticker: 'BBB', name: 'Beta', weightPct: 5 },
  ]);
  assert.equal(holdings.length, 2);
  assert.equal(holdings.reduce((sum, holding) => sum + holding.weightPct, 0), 15);
});

test('holdings older than 45 days are explicitly stale', () => {
  const now = new Date('2026-07-14T00:00:00Z').getTime();
  assert.equal(isHoldingsStale('2026-06-30T00:00:00Z', now), false);
  assert.equal(isHoldingsStale('2026-05-01T00:00:00Z', now), true);
  assert.equal(isHoldingsStale('invalid', now), true);
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

test('complete quote coverage produces a full unscaled estimate', () => {
  const holdings = [
    { ticker: 'AAA', name: 'Alpha', weightPct: 60 },
    { ticker: 'BBB', name: 'Beta', weightPct: 40 },
  ];
  const quotes = new Map([
    ['AAA', { quote: { dayChangePct: 2, currency: 'SEK', asOf: '2026-07-10T10:00:00Z', stale: false } }],
    ['BBB', { quote: { dayChangePct: -1, currency: 'SEK', asOf: '2026-07-10T10:00:00Z', stale: false } }],
  ]);
  const result = buildContributionSummary(holdings, quotes, { fundCurrency: 'SEK' });
  assert.equal(result.summary.disclosedCoveragePct, 100);
  assert.equal(result.summary.calculatedCoveragePct, 100);
  assert.equal(result.summary.uncalculatedWeightPct, 0);
  assert.equal(result.summary.undisclosedWeightPct, 0);
  assert.equal(result.summary.isPartial, false);
  assert.equal(result.summary.scaledToFullPortfolio, false);
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
