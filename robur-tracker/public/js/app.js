import { getContributors, getFund, searchFunds } from './fundApi.js';
import {
  addToComparison,
  getComparison,
  getCurrentFund,
  getFavorites,
  isFavorite,
  removeFromComparison,
  setCurrentFund,
  toggleFavorite,
} from './fundStore.js';
import { getChartColors, normaliseSeries, renderChart } from './chart.js';
import { formatDate, formatDateTime, formatPctPoints, formatPercent, formatUnsignedPercent, formatValue, freshnessLabel, rangeLabel } from './format.js';
import { deriveIntradayEstimate } from './intradayEstimate.js';

const DEFAULT_FUND = {
  symbol: '0P00000LCG.ST',
  name: 'Swedbank Robur Technology A',
  exchange: 'Stockholm',
  currency: 'SEK',
  isin: 'SE0000538944',
};

const state = {
  view: 'overview',
  range: '1y',
  compareRange: '1y',
  current: null,
  fundResult: null,
  compareResults: [],
  contributorsResult: null,
  contributorsRequest: 0,
  searchTimer: null,
  toastTimer: null,
};

const el = (id) => document.getElementById(id);

function announce(message) {
  el('app-status').textContent = message;
}

function setConnection(label, mode = 'ready') {
  const status = el('connection-status');
  status.dataset.mode = mode;
  status.querySelector('span:last-child').textContent = label;
}

function showError(message) {
  el('error-banner').textContent = message;
  el('error-banner').hidden = false;
}

function clearError() {
  el('error-banner').hidden = true;
}

function showToast(message) {
  const toast = el('toast');
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (view === 'compare') renderComparison();
  if (view === 'saved') renderSaved();
  el('main-content').focus({ preventScroll: true });
}

function getRequestedFund() {
  const symbol = new URL(location.href).searchParams.get('fund');
  if (symbol) return { ...DEFAULT_FUND, symbol, name: symbol, isin: symbol === DEFAULT_FUND.symbol ? DEFAULT_FUND.isin : null };
  return getCurrentFund() || DEFAULT_FUND;
}

async function loadFund(fund, options = {}) {
  state.current = { ...fund };
  setCurrentFund(state.current);
  el('fund-loading').hidden = false;
  el('fund-loading').setAttribute('aria-busy', 'true');
  el('fund-content').hidden = true;
  clearError();
  setConnection('Hämtar data', 'loading');
  announce(`Hämtar ${fund.name || fund.symbol}`);

  try {
    const result = await getFund(fund.symbol, state.range, options);
    state.fundResult = result;
    const metadata = {
      ...fund,
      symbol: result.data.fund.symbol,
      name: result.data.fund.name,
      currency: result.data.fund.currency,
      exchange: result.data.fund.exchange,
      isin: fund.isin || (result.data.fund.symbol === DEFAULT_FUND.symbol ? DEFAULT_FUND.isin : null),
    };
    state.current = metadata;
    setCurrentFund(metadata);
    renderFund(result);
    loadContributors(metadata.symbol, result.data.latest.asOf, result.data.fund.currency, result.data.latest.dayChangePct, options);
    updateUrl(metadata.symbol);
    setConnection(result.stale || result.data.latest.stale ? 'Visar äldre data' : 'Data hämtad', result.stale ? 'warning' : 'ready');
    if (result.stale) showError('Datakällan svarar inte. En tidigare sparad version visas och kan vara inaktuell.');
    announce(`${metadata.name} har laddats`);
  } catch (error) {
    console.error(error);
    showError(`Fonden kunde inte laddas: ${error.message}`);
    setConnection('Data saknas', 'error');
    announce('Fonddata kunde inte laddas');
  } finally {
    el('fund-loading').hidden = true;
    el('fund-loading').setAttribute('aria-busy', 'false');
  }
}

async function loadContributors(symbol, navAsOf, currency, officialNavChangePct, options = {}) {
  const requestId = ++state.contributorsRequest;
  state.contributorsResult = null;
  el('contributors-loading').hidden = false;
  el('contributors-content').hidden = true;
  el('contributors-unavailable').hidden = true;
  el('contributors-status').textContent = 'Hämtar data';
  el('contributors-status').classList.remove('is-stale');
  setIntradayEstimateLoading();

  try {
    const result = await getContributors(symbol, navAsOf, currency, options);
    if (requestId !== state.contributorsRequest || state.current?.symbol !== symbol) return;
    state.contributorsResult = result;
    renderContributors(result, officialNavChangePct);
  } catch (error) {
    if (requestId !== state.contributorsRequest || state.current?.symbol !== symbol) return;
    el('contributors-unavailable').textContent = `Innehavens dagsbidrag kan inte visas just nu: ${error.message}`;
    el('contributors-unavailable').hidden = false;
    el('contributors-status').textContent = 'Data saknas';
    el('contributors-status').classList.add('is-stale');
    renderIntradayEstimateError(error.message);
  } finally {
    if (requestId === state.contributorsRequest) el('contributors-loading').hidden = true;
  }
}

function renderContributors(result, officialNavChangePct) {
  const { data, stale } = result;
  const delayedItems = data.items.filter((item) => item.status === 'stale').length;
  const hasWarnings = stale || delayedItems > 0 || data.unavailable.length > 0;
  el('contributors-content').hidden = false;
  el('contributors-status').textContent = stale ? 'Äldre cache' : hasWarnings ? 'Delvis data' : 'Data hämtad';
  el('contributors-status').classList.toggle('is-stale', hasWarnings);

  setContributionValue(el('positive-contribution'), data.summary.positivePctPoints);
  setContributionValue(el('negative-contribution'), data.summary.negativePctPoints);
  setContributionValue(el('net-contribution'), data.summary.netPctPoints);
  el('contributors-coverage').textContent = `Beräknat ${formatUnsignedPercent(data.summary.calculatedCoveragePct)} av fonden · ${data.summary.availableCount}/${data.summary.holdingsCount} toppinnehav`;
  el('contributors-updated').textContent = `Senaste kurs: ${formatDateTime(data.latestDataAt)}`;
  el('contributors-source').textContent = `Källa: ${data.source.label} · fördröjd data`;
  renderIntradayEstimate(result, officialNavChangePct);

  renderContributorList(el('winners-list'), data.winners, 'Inga positiva bidrag i tillgänglig dagsdata.');
  renderContributorList(el('losers-list'), data.losers, 'Inga negativa bidrag i tillgänglig dagsdata.');
  const unavailableSection = el('unavailable-holdings');
  unavailableSection.hidden = data.unavailable.length === 0;
  renderContributorList(el('unavailable-list'), data.unavailable, '', true);
}

function setIntradayEstimateLoading() {
  const container = el('intraday-estimate');
  container.dataset.state = 'loading';
  el('intraday-estimate-label').textContent = 'Uppskattning sedan senaste NAV';
  el('intraday-estimate-value').textContent = 'Beräknar…';
  el('intraday-estimate-value').className = 'neutral';
  el('intraday-estimate-coverage').textContent = 'Hämtar innehav, kurser och valutadata.';
  el('intraday-estimate-details').textContent = '';
}

function renderIntradayEstimate(result, officialNavChangePct) {
  const { data, stale } = result;
  const estimate = deriveIntradayEstimate(data.summary, officialNavChangePct);
  const value = el('intraday-estimate-value');
  const container = el('intraday-estimate');
  if (!estimate.hasEstimate) {
    renderIntradayEstimateError('Ingen tillräckligt aktuell och valutajusterad innehavsdata kunde beräknas.');
    return;
  }

  container.dataset.state = stale ? 'warning' : 'ready';
  el('intraday-estimate-label').textContent = estimate.isPartial
    ? 'Partiell uppskattning sedan senaste NAV'
    : 'Uppskattning sedan senaste NAV';
  value.textContent = formatPercent(estimate.estimatedChangePct);
  value.className = estimate.estimatedChangePct > 0 ? 'positive' : estimate.estimatedChangePct < 0 ? 'negative' : 'neutral';
  el('intraday-estimate-coverage').textContent = estimate.isPartial
    ? `${formatUnsignedPercent(estimate.coveragePct)} av fonden beräknad · inte uppräknad till 100 %`
    : `${formatUnsignedPercent(estimate.coveragePct)} av fonden beräknad`;
  const warnings = [];
  if (stale) warnings.push('äldre cache');
  if (data.source?.delayed) warnings.push('fördröjd marknadsdata');
  if (data.unavailable.length) warnings.push(`${data.unavailable.length} innehav utan användbar data`);
  if (data.summary.currencyAdjustedCount) warnings.push(`${data.summary.currencyAdjustedCount} valutajusterade`);
  el('intraday-estimate-details').textContent = [
    `Beräknad ${formatDateTime(data.calculatedAt)}`,
    `senaste marknadsdata ${formatDateTime(data.latestDataAt)}`,
    `NAV ${formatDate(data.baseline?.navAsOf)}`,
    ...warnings,
  ].join(' · ');
}

function renderIntradayEstimateError(message) {
  const container = el('intraday-estimate');
  container.dataset.state = 'warning';
  el('intraday-estimate-label').textContent = 'Uppskattning sedan senaste NAV';
  el('intraday-estimate-value').textContent = 'Saknas';
  el('intraday-estimate-value').className = 'neutral';
  el('intraday-estimate-coverage').textContent = message;
  el('intraday-estimate-details').textContent = 'Senast rapporterade NAV ovan påverkas inte.';
}

function setContributionValue(element, value) {
  element.textContent = formatPctPoints(value);
  element.classList.remove('positive', 'negative', 'neutral');
  element.classList.add(value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral');
}

function renderContributorList(container, items, emptyMessage, unavailable = false) {
  container.replaceChildren();
  if (!items.length && emptyMessage) {
    const empty = document.createElement('p');
    empty.className = 'contributor-empty';
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('article');
    row.className = `contributor-row${unavailable ? ' is-unavailable' : ''}`;
    const identity = document.createElement('div');
    identity.className = 'contributor-identity';
    const name = document.createElement('strong');
    name.textContent = item.name;
    const ticker = document.createElement('span');
    ticker.textContent = item.resolvedTicker && item.resolvedTicker !== item.ticker
      ? `${item.ticker} · kurs ${item.resolvedTicker}`
      : item.ticker;
    identity.append(name, ticker);

    const metrics = document.createElement('dl');
    metrics.className = 'contributor-metrics';
    appendMetric(metrics, 'Kurs', Number.isFinite(item.localDayChangePct) ? formatPercent(item.localDayChangePct) : 'Saknas');
    appendMetric(metrics, 'Valuta', item.fxPair ? (Number.isFinite(item.fxChangePct) ? formatPercent(item.fxChangePct) : 'Saknas') : '–');
    appendMetric(metrics, 'Fondvikt', formatUnsignedPercent(item.weightPct));
    appendMetric(metrics, 'Bidrag', unavailable ? 'Ej beräknat' : formatPctPoints(item.contributionPctPoints));
    row.append(identity, metrics);

    if (item.reason) {
      const reason = document.createElement('p');
      reason.className = 'contributor-reason';
      reason.textContent = item.reason;
      row.append(reason);
    }
    container.append(row);
  });
}

function appendMetric(list, label, value) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);
  list.append(wrapper);
}

function renderFund(result) {
  const { data, stale: cachedStale } = result;
  const stale = cachedStale || data.latest.stale;
  el('fund-content').hidden = false;
  el('fund-name').textContent = data.fund.name;
  el('fund-symbol').textContent = data.fund.symbol;
  el('fund-exchange').textContent = data.fund.exchange || 'Okänd marknadsplats';
  el('fund-type').textContent = data.fund.instrumentType === 'MUTUALFUND' ? 'Fond' : data.fund.instrumentType;
  el('fund-freshness').textContent = freshnessLabel(data.latest.ageHours, stale);
  el('fund-freshness').classList.toggle('is-stale', stale);
  el('fund-isin-wrap').hidden = !state.current.isin;
  el('fund-isin').textContent = state.current.isin || '';

  el('latest-value').textContent = formatValue(data.latest.value, null);
  el('latest-currency').textContent = data.fund.currency || '';
  setChange(el('daily-change'), data.latest.dayChangePct);
  el('value-date').textContent = formatDate(data.latest.asOf);
  el('value-source').textContent = data.source.label;
  el('value-status').textContent = stale ? 'Inaktuell / cache' : 'Rapporterad, fördröjd';

  setChange(el('period-return'), data.period.changePct, true);
  el('period-high').textContent = formatValue(data.period.high, data.fund.currency);
  el('period-low').textContent = formatValue(data.period.low, data.fund.currency);
  el('period-points').textContent = new Intl.NumberFormat('sv-SE').format(data.period.points);
  el('chart-summary').textContent = `${data.fund.name} förändrades ${formatPercent(data.period.changePct)} under ${rangeLabel(state.range)}, från ${formatValue(data.period.startValue, data.fund.currency)} till ${formatValue(data.period.endValue, data.fund.currency)}.`;
  const chartColors = getChartColors();
  renderChart(el('fund-chart'), [{ name: data.fund.name, points: data.history, color: chartColors[0] }]);

  const favorite = isFavorite(data.fund.symbol);
  el('favorite-button').setAttribute('aria-pressed', String(favorite));
  el('favorite-button').querySelector('[aria-hidden]').textContent = favorite ? '♥' : '♡';
  el('favorite-button').querySelector('.button-label').textContent = favorite ? 'Sparad' : 'Spara';
  updateCounts();
}

function setChange(element, value, plain = false) {
  element.textContent = formatPercent(value);
  element.classList.remove('positive', 'negative', 'neutral');
  element.classList.add(value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral');
  if (!plain) element.setAttribute('aria-label', `Förändring ${formatPercent(value)}`);
}

function updateUrl(symbol) {
  const url = new URL(location.href);
  url.searchParams.set('fund', symbol);
  history.replaceState({ fund: symbol }, '', url);
}

function updateCounts() {
  const count = getComparison().length;
  el('compare-count').textContent = count;
  el('compare-count').hidden = count === 0;
}

function openSearch() {
  const dialog = el('search-dialog');
  if (!dialog.open) dialog.showModal();
  el('fund-search').focus();
  if (!el('search-results').children.length) runSearch('');
}

async function runSearch(query) {
  el('search-spinner').hidden = false;
  el('search-help').textContent = query ? `Söker efter ”${query}”` : 'Utvalda fonder';
  try {
    const { funds, error } = await searchFunds(query);
    renderSearchResults(funds || []);
    el('search-help').textContent = error || (funds?.length ? `${funds.length} fonder hittades` : 'Inga fonder hittades. Prova ett annat namn, symbol eller ISIN.');
  } catch (error) {
    renderSearchResults([]);
    el('search-help').textContent = `Sökningen misslyckades: ${error.message}`;
  } finally {
    el('search-spinner').hidden = true;
  }
}

function renderSearchResults(funds) {
  const container = el('search-results');
  container.replaceChildren();
  funds.forEach((fund) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';
    button.setAttribute('role', 'option');
    const main = document.createElement('span');
    main.className = 'search-result-main';
    const name = document.createElement('strong');
    name.textContent = fund.name;
    const meta = document.createElement('span');
    meta.textContent = [fund.isin, fund.symbol, fund.exchange].filter(Boolean).join(' · ');
    const arrow = document.createElement('span');
    arrow.className = 'search-result-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    main.append(name, meta);
    button.append(main, arrow);
    button.addEventListener('click', () => {
      el('search-dialog').close();
      setView('overview');
      loadFund(fund);
    });
    container.append(button);
  });
}

async function renderComparison() {
  const funds = getComparison();
  updateCounts();
  el('compare-empty').hidden = funds.length > 0;
  el('compare-content').hidden = funds.length === 0;
  if (!funds.length) return;

  announce('Hämtar jämförelsedata');
  const settled = await Promise.allSettled(funds.map((fund) => getFund(fund.symbol, state.compareRange)));
  state.compareResults = settled
    .map((result, index) => result.status === 'fulfilled' ? { saved: funds[index], ...result.value.data } : null)
    .filter(Boolean);

  const chartColors = getChartColors();
  const series = state.compareResults.map((result, index) => ({
    name: result.fund.name,
    points: normaliseSeries(result.history),
    color: chartColors[index],
  }));
  renderChart(el('compare-chart'), series, { percent: true });
  renderCompareLegend(series);
  renderCompareCards(state.compareResults);
  announce('Jämförelsedata har laddats');
}

function renderCompareLegend(series) {
  const legend = el('compare-legend');
  legend.replaceChildren();
  series.forEach((item) => {
    const entry = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.backgroundColor = item.color;
    entry.append(swatch, document.createTextNode(item.name));
    legend.append(entry);
  });
}

function renderCompareCards(results) {
  const container = el('compare-list');
  const chartColors = getChartColors();
  container.replaceChildren();
  results.forEach((result, index) => {
    const card = document.createElement('article');
    card.className = 'card fund-row-card';
    const color = document.createElement('i');
    color.className = 'fund-color';
    color.style.backgroundColor = chartColors[index];
    const text = document.createElement('div');
    const name = document.createElement('h2');
    name.textContent = result.fund.name;
    const meta = document.createElement('p');
    meta.textContent = `${result.fund.symbol} · ${formatDate(result.latest.asOf)}`;
    text.append(name, meta);
    const change = document.createElement('strong');
    change.textContent = formatPercent(result.period.changePct);
    change.className = result.period.changePct >= 0 ? 'positive' : 'negative';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'close-button small';
    remove.setAttribute('aria-label', `Ta bort ${result.fund.name} från jämförelsen`);
    remove.textContent = '×';
    remove.addEventListener('click', () => { removeFromComparison(result.fund.symbol); renderComparison(); });
    card.append(color, text, change, remove);
    container.append(card);
  });
}

function renderSaved() {
  const favorites = getFavorites();
  el('saved-empty').hidden = favorites.length > 0;
  const container = el('saved-list');
  container.replaceChildren();
  favorites.forEach((fund) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card saved-card';
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = fund.name;
    const meta = document.createElement('span');
    meta.textContent = [fund.isin, fund.symbol, fund.exchange].filter(Boolean).join(' · ');
    const arrow = document.createElement('span');
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    copy.append(name, meta);
    card.append(copy, arrow);
    card.addEventListener('click', () => { setView('overview'); loadFund(fund); });
    container.append(card);
  });
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('[data-view-link]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.viewLink)));
  document.querySelectorAll('[data-open-search], #open-search').forEach((button) => button.addEventListener('click', openSearch));
  el('close-search').addEventListener('click', () => el('search-dialog').close());
  el('search-form').addEventListener('submit', (event) => event.preventDefault());
  el('fund-search').addEventListener('input', (event) => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => runSearch(event.target.value), 300);
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
  });
  el('range-picker').addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (!button || button.dataset.range === state.range) return;
    state.range = button.dataset.range;
    document.querySelectorAll('[data-range]').forEach((item) => item.classList.toggle('is-active', item === button));
    loadFund(state.current);
  });
  el('compare-range').addEventListener('click', (event) => {
    const button = event.target.closest('[data-compare-range]');
    if (!button || button.dataset.compareRange === state.compareRange) return;
    state.compareRange = button.dataset.compareRange;
    document.querySelectorAll('[data-compare-range]').forEach((item) => item.classList.toggle('is-active', item === button));
    renderComparison();
  });
  el('favorite-button').addEventListener('click', () => {
    const added = toggleFavorite(state.current);
    renderFund(state.fundResult);
    showToast(added ? 'Fonden sparades på den här enheten.' : 'Fonden togs bort från sparade.');
  });
  el('compare-button').addEventListener('click', () => {
    const result = addToComparison(state.current);
    updateCounts();
    if (result.added) showToast('Fonden lades till i jämförelsen.');
    else if (result.reason === 'full') showToast('Jämförelsen har plats för högst tre fonder.');
    else showToast('Fonden finns redan i jämförelsen.');
  });
  el('share-button').addEventListener('click', shareCurrentFund);
  window.addEventListener('resize', () => {
    if (state.view === 'overview' && state.fundResult) renderFund(state.fundResult);
    if (state.view === 'compare' && state.compareResults.length) {
      const chartColors = getChartColors();
      renderChart(el('compare-chart'), state.compareResults.map((result, index) => ({ name: result.fund.name, points: normaliseSeries(result.history), color: chartColors[index] })), { percent: true });
    }
  });
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  colorScheme.addEventListener?.('change', () => {
    if (state.view === 'overview' && state.fundResult) renderFund(state.fundResult);
    if (state.view === 'compare') renderComparison();
  });
  window.addEventListener('online', () => { setConnection('Ansluten', 'ready'); if (state.current) loadFund(state.current, { forceRefresh: true }); });
  window.addEventListener('offline', () => setConnection('Offline', 'warning'));
}

async function shareCurrentFund() {
  const payload = { title: state.current.name, text: `Se ${state.current.name} i Fondkoll`, url: location.href };
  try {
    if (navigator.share) await navigator.share(payload);
    else { await navigator.clipboard.writeText(location.href); showToast('Länken kopierades.'); }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('Länken kunde inte delas.');
  }
}

async function init() {
  bindEvents();
  updateCounts();
  await loadFund(getRequestedFund());
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
