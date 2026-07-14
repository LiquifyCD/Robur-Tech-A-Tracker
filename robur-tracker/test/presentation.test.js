import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatDate, formatPctPoints, formatPercent, formatUnsignedPercent, formatValue, freshnessLabel } from '../public/js/format.js';
import { normaliseSeries } from '../public/js/chart.js';

test('currency values and percentages use Swedish presentation without changing the amount', () => {
  assert.match(formatValue(1234.5, 'SEK'), /1\s?234,50 SEK/);
  assert.match(formatPercent(2.345), /^\+2,35/);
  assert.match(formatPercent(-1.2), /1,20/);
  assert.match(formatPctPoints(0.4), /^\+0,40 pp$/);
  assert.match(formatUnsignedPercent(10), /^10,00/);
  assert.doesNotMatch(formatUnsignedPercent(10), /^\+/);
});

test('ISO dates are presented as valid Swedish dates and invalid input is explicit', () => {
  assert.match(formatDate('2026-07-08T00:00:00.000Z'), /8 juli 2026/);
  assert.equal(formatDate('not-a-date'), '–');
  assert.equal(freshnessLabel(12, false), 'Senaste bankdag');
  assert.equal(freshnessLabel(130, true), 'Inaktuell data');
});

test('comparison series start at zero and preserve real observations', () => {
  assert.deepEqual(normaliseSeries([{ t: 1, v: 50 }, { t: 2, v: 55 }]), [{ t: 1, v: 0 }, { t: 2, v: 10 }]);
});

test('UI contract includes responsive navigation, safe areas, landmarks, and reduced motion', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(html, /<nav[^>]+aria-label="Huvudmeny"/);
  assert.match(html, /<main id="main-content"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /--topbar-height: calc\(60px \+ env\(safe-area-inset-top\)\)/);
  assert.match(css, /padding: calc\(var\(--topbar-height\) \+ 20px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(html, /content="light dark"/);
  assert.match(html, /theme-color[^>]+prefers-color-scheme: dark/);
  assert.match(html, /id="contributors-section"/);
  assert.match(html, /id="daily-change"/);
  assert.match(html, /id="intraday-estimate-value"/);
  assert.match(html, /uppskattat sedan senaste NAV/);
  assert.match(html, /class="change-row"[\s\S]*id="daily-change"[\s\S]*id="intraday-estimate-value"/);
  assert.match(app, /inte uppräknat/);
  assert.match(app, /fördröjd marknadsdata/);
  assert.match(html, /Dagens vinnare/);
  assert.match(html, /Dagens förlorare/);
  assert.match(html, /valutajusterad förändring × fondvikt \/ 100/i);
  assert.match(html, /Innehav utan användbar dagsdata/);
  assert.doesNotMatch(html, /class="brand(?:-mark)?"/);
  assert.match(css, /\.icon-button \{[^}]*min-height: 44px/s);
  assert.match(css, /\.segmented-control button \{[^}]*height: 44px/s);
});

test('PWA and worker security contracts remain wired', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.json', import.meta.url), 'utf8'));
  const worker = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.equal(manifest.display, 'standalone');
  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /X-Content-Type-Options/);
  assert.match(serviceWorker, /\/api\//);
});
