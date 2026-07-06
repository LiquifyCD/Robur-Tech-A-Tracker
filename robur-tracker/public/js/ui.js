/**
 * ui.js
 * ---------------------------------------------------------------------------
 * All DOM reads/writes live here. app.js calls these render functions with
 * plain data; nothing in this file fetches data or does business math, so
 * it's easy to reason about and easy to swap out later (e.g. for a
 * framework) without touching the data layer.
 * ---------------------------------------------------------------------------
 */

import * as chart from './chart.js';

const el = (id) => document.getElementById(id);

const fmtPct = (v, digits = 2) =>
  `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;

const fmtTime = (date) =>
  new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);

function setChangeClasses(elem, value) {
  elem.classList.remove('positive', 'negative', 'neutral');
  if (value > 0) elem.classList.add('positive');
  else if (value < 0) elem.classList.add('negative');
  else elem.classList.add('neutral');
}

/** Headline estimated % change for the day. */
export function renderEstimate({ estimatedChangePct, coveragePct }) {
  const headline = el('headline-change');
  headline.textContent = fmtPct(estimatedChangePct);
  setChangeClasses(headline, estimatedChangePct);

  el('coverage-note').textContent = `Baserat på innehav som representerar ${coveragePct.toFixed(0)}% av portföljen`;
}

export function renderMarketStatus(isOpen) {
  const badge = el('market-status');
  badge.textContent = isOpen ? 'Marknaden är öppen' : 'Marknaden är stängd';
  badge.classList.toggle('status-open', isOpen);
  badge.classList.toggle('status-closed', !isOpen);
}

export function renderLastUpdate(date) {
  el('last-update').textContent = `Senast uppdaterad: ${fmtTime(date)}`;
}

export function renderLiveIndicator(active) {
  el('live-dot').classList.toggle('live-active', active);
  el('live-label').textContent = active ? 'Live' : 'Pausad';
}

export function renderHoldingsMeta({ asOfDate, source, stale }) {
  const note = el('holdings-date-note');
  const label = source === 'bundled-seed' ? 'inbyggd startdata' : `hämtat ${asOfDate}`;
  note.textContent = stale
    ? `⚠ Använder cachat innehav (${label}) - kunde inte hämta senaste data`
    : `Innehav från ${asOfDate}`;
  note.classList.toggle('warning', stale);
}

export function renderGainersLosers({ gainers, losers }) {
  const renderList = (container, items) => {
    container.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('li');
      row.className = 'contributor-row';
      row.innerHTML = `
        <span class="contributor-name">${item.name}</span>
        <span class="contributor-change ${item.changePct >= 0 ? 'positive' : 'negative'}">
          ${fmtPct(item.changePct)}
        </span>
      `;
      container.appendChild(row);
    });
  };
  renderList(el('gainers-list'), gainers.filter((g) => g.changePct > 0));
  renderList(el('losers-list'), losers.filter((l) => l.changePct < 0));
}

export function renderChart() {
  chart.render(el('intraday-chart'));
}

export function addChartPoint(value) {
  chart.addPoint(value);
}

/** Non-blocking banner for connectivity / data-freshness issues. */
export function showErrorBanner(message) {
  const banner = el('error-banner');
  banner.textContent = message;
  banner.hidden = false;
}

export function hideErrorBanner() {
  el('error-banner').hidden = true;
}

export function showFatalError(message) {
  el('app-root').setAttribute('aria-busy', 'false');
  showErrorBanner(message);
}

export function setLoading(isLoading) {
  el('app-root').setAttribute('aria-busy', String(isLoading));
  el('content').hidden = isLoading;
}
