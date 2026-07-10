import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFundChart, percentChange } from '../functions/api/fund.js';
import { normaliseSearchResults } from '../functions/api/funds.js';

const chartFixture = {
  meta: {
    symbol: 'TEST.ST',
    longName: 'Test Fund A',
    currency: 'SEK',
    fullExchangeName: 'Stockholm',
    instrumentType: 'MUTUALFUND',
    exchangeTimezoneName: 'Europe/Stockholm',
  },
  timestamp: [1_700_000_000, 1_700_086_400, 1_700_172_800, 1_700_259_200],
  indicators: { adjclose: [{ adjclose: [100, null, 104, 110] }] },
};

test('fund adapter skips missing values instead of interpolating them', () => {
  const data = parseFundChart(chartFixture, 1_700_300_000_000);
  assert.deepEqual(data.history.map((point) => point.v), [100, 104, 110]);
  assert.equal(data.period.points, 3);
  assert.equal(data.period.changePct, 10);
  assert.ok(Math.abs(data.latest.dayChangePct - 5.769230769) < 1e-6);
});

test('fund freshness is determined from the last real datapoint', () => {
  const recent = parseFundChart(chartFixture, 1_700_300_000_000);
  const stale = parseFundChart(chartFixture, 1_701_000_000_000);
  assert.equal(recent.latest.stale, false);
  assert.equal(stale.latest.stale, true);
  assert.equal(stale.latest.status, 'stale');
});

test('percent change rejects invalid bases and calculates valid returns', () => {
  assert.equal(percentChange(200, 210), 5);
  assert.equal(percentChange(0, 10), null);
  assert.equal(percentChange(Number.NaN, 10), null);
});

test('search adapter keeps mutual funds, de-duplicates symbols, and strips extra fields', () => {
  const funds = normaliseSearchResults({ quotes: [
    { quoteType: 'EQUITY', symbol: 'NOPE', longname: 'Not a fund' },
    { quoteType: 'MUTUALFUND', symbol: 'A.ST', longname: 'Alpha', exchDisp: 'Stockholm', secret: 'drop' },
    { quoteType: 'MUTUALFUND', symbol: 'A.ST', longname: 'Duplicate' },
  ] });
  assert.deepEqual(funds, [{ symbol: 'A.ST', name: 'Alpha', exchange: 'Stockholm', currency: null, isin: null, type: 'MUTUALFUND' }]);
});
