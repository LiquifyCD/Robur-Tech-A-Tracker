import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContributionSummary,
  calculateContribution,
  normaliseWeightPct,
  parseDailyQuote,
  parseHoldings,
} from '../functions/api/contributors.js';

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
