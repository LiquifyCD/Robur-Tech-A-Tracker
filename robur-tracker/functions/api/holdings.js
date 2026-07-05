/**
 * GET /api/holdings?isin=SE0000538944
 * ---------------------------------------------------------------------------
 * Fetches and parses the fund's publicly disclosed "top holdings" table
 * from its factsheet, generated on demand by FundConnect (the document
 * platform white-labelled by several Nordic banks/insurers, including the
 * one used by Nordea for third-party fund pages). This is a genuinely
 * public, no-login endpoint that isn't specific to Nordea's own customers.
 *
 * WHY THIS SOURCE:
 * There is no free source - official or otherwise - that publishes this
 * fund's FULL live portfolio. Every retail channel (Avanza, Nordnet,
 * Morningstar, the fund company itself) discloses only a "top N holdings"
 * snapshot, refreshed roughly monthly. FundConnect's factsheet generator
 * is used here because:
 *   - it's a document API rather than a consumer web app, so it's far
 *     less likely to change its DOM/bundle or add bot-detection than a
 *     bank's own website,
 *   - it returns the disclosed top-10 holdings with weight, country and
 *     sector in a consistent, parseable layout.
 * The trade-off is coverage: the top 10 typically represent 45-55% of
 * the fund's assets. holdings.js on the client is written to treat this
 * honestly (normalized weights + a visible coverage %), not to pretend
 * it's the whole portfolio.
 *
 * WHY A PDF PARSER:
 * The factsheet is served as a PDF. We use `unpdf` (a serverless build of
 * PDF.js with zero native dependencies) to extract its text inside the
 * Cloudflare Workers runtime, then apply a small, well-commented parser
 * to pull out the "De tio största innehaven" (Top 10 holdings) table.
 *
 * TICKER RESOLUTION:
 * The factsheet gives company names, not stock tickers - no free source
 * publishes both together for this fund. We resolve names to tickers via
 * a maintained lookup table of the fund's recurring large-cap holdings
 * (see NAME_TO_TICKER below). This is the one piece of this module that
 * needs occasional manual upkeep if the fund initiates a genuinely new
 * position that has never appeared in its top 10 before; everything else
 * - the actual holdings list and weights - is retrieved fresh every run.
 * ---------------------------------------------------------------------------
 */

import { extractText, getDocumentProxy } from 'unpdf';

const FACTSHEET_URL =
  'https://fundsnow.os.fundconnect.com/api/v1/public/printer/solutions/default/dynamic-factsheet' +
  '?language=sv-SE&currency=SEK&clientID=SELP&shelves=SELP+UNIT+LINKED&isin=SE0000538944';

const CACHE_TTL_SECONDS = 12 * 60 * 60; // 12h edge cache; client also caches 24h

// Maintained name -> ticker/country map. Matching is case-insensitive
// substring matching against the factsheet's company name field, ordered
// so more specific patterns are checked first.
const NAME_TO_TICKER = [
  { pattern: /nvidia/i, ticker: 'NVDA' },
  { pattern: /broadcom/i, ticker: 'AVGO' },
  { pattern: /microsoft/i, ticker: 'MSFT' },
  { pattern: /taiwan semiconductor/i, ticker: 'TSM' },
  { pattern: /\bapple\b/i, ticker: 'AAPL' },
  { pattern: /kla[-\s]?tencor|\bkla\b/i, ticker: 'KLAC' },
  { pattern: /analog devices/i, ticker: 'ADI' },
  { pattern: /applied materials/i, ticker: 'AMAT' },
  { pattern: /micron/i, ticker: 'MU' },
  { pattern: /advanced micro devices/i, ticker: 'AMD' },
  { pattern: /\boracle\b/i, ticker: 'ORCL' },
  { pattern: /lam research/i, ticker: 'LRCX' },
  { pattern: /seagate/i, ticker: 'STX' },
  { pattern: /cadence/i, ticker: 'CDNS' },
  { pattern: /servicenow/i, ticker: 'NOW' },
  { pattern: /amazon/i, ticker: 'AMZN' },
  { pattern: /marvell/i, ticker: 'MRVL' },
  { pattern: /arista/i, ticker: 'ANET' },
  { pattern: /meta platforms|\bmeta\b/i, ticker: 'META' },
  { pattern: /fortinet/i, ticker: 'FTNT' },
  { pattern: /motorola solutions/i, ticker: 'MSI' },
  { pattern: /amphenol/i, ticker: 'APH' },
  { pattern: /\bintel\b/i, ticker: 'INTC' },
  { pattern: /palantir/i, ticker: 'PLTR' },
  { pattern: /snowflake/i, ticker: 'SNOW' },
  { pattern: /alphabet|\bgoogle\b/i, ticker: 'GOOGL' },
  { pattern: /qualcomm/i, ticker: 'QCOM' },
  { pattern: /texas instruments/i, ticker: 'TXN' },
  { pattern: /synopsys/i, ticker: 'SNPS' },
  { pattern: /crowdstrike/i, ticker: 'CRWD' },
  { pattern: /salesforce/i, ticker: 'CRM' },
];

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const pdfRes = await fetch(FACTSHEET_URL, {
      headers: { Accept: 'application/pdf' },
    });
    if (!pdfRes.ok) throw new Error(`Factsheet fetch failed: ${pdfRes.status}`);

    const buffer = await pdfRes.arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });

    const parsed = parseFactsheetText(text);

    const response = new Response(JSON.stringify(parsed), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
        'Access-Control-Allow-Origin': '*',
      },
    });
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: `Holdings fetch/parse failed: ${err.message}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Parse the "De tio största innehaven" (top 10 holdings) table out of the
 * factsheet's extracted plain text. The table appears as one row per
 * line: "<Company name> <Country> <Sector> <weight-with-comma-decimal>".
 *
 * Example line: "NVIDIA Corp USA IT 9,27"
 *
 * @param {string} text - full extracted PDF text
 */
function parseFactsheetText(text) {
  const startMarker = /De tio största innehaven\s*([\d-]+)?/i;
  const startMatch = text.match(startMarker);
  if (!startMatch) throw new Error('Could not locate holdings table in factsheet');

  const asOfDateMatch = text.match(/De tio största innehaven\s*(\d{4}-\d{2}-\d{2})/);
  const asOfDate = asOfDateMatch ? asOfDateMatch[1] : new Date().toISOString().slice(0, 10);

  // Grab everything after the table header up to the next section marker.
  const tableStart = startMatch.index + startMatch[0].length;
  const afterHeader = text.slice(tableStart);
  const headerCleanup = afterHeader.replace(/^\s*Land\s*Sektor\s*%\s*av\s*portfölj/i, '');
  const endMarkers = [/Fullständig information/i, /\n1\/2/, /Priser\b/i];
  let tableSection = headerCleanup;
  for (const marker of endMarkers) {
    const m = tableSection.match(marker);
    if (m) {
      tableSection = tableSection.slice(0, m.index);
      break;
    }
  }

  const rowPattern = /^(.+?)\s+(\S+)\s+(\S+)\s+(\d{1,2},\d{1,2})\s*$/gm;
  const holdings = [];
  let match;
  while ((match = rowPattern.exec(tableSection)) !== null) {
    const [, rawName, country, sector, rawWeight] = match;
    const name = rawName.trim();
    if (!name || name.length < 2) continue;

    const weightPct = parseFloat(rawWeight.replace(',', '.'));
    if (Number.isNaN(weightPct)) continue;

    const resolved = NAME_TO_TICKER.find((entry) => entry.pattern.test(name));
    if (!resolved) {
      // Skip holdings we can't confidently map to a ticker rather than
      // guessing - see NAME_TO_TICKER comment above.
      continue;
    }

    holdings.push({
      name,
      ticker: resolved.ticker,
      country,
      sector,
      weightPct,
    });
  }

  if (holdings.length === 0) {
    throw new Error('Parsed zero holdings - factsheet layout may have changed');
  }

  return {
    asOfDate,
    fetchedAt: new Date().toISOString(),
    holdings,
  };
}
