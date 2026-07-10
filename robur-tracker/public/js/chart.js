import { formatPercent, formatShortDate } from './format.js';

const FALLBACK_SERIES_COLORS = ['#176b52', '#6f5bc7', '#d26a3a'];

export function getChartColors() {
  if (typeof document === 'undefined') return FALLBACK_SERIES_COLORS;
  const styles = getComputedStyle(document.documentElement);
  return ['--chart-primary', '--chart-secondary', '--chart-tertiary'].map(
    (name, index) => styles.getPropertyValue(name).trim() || FALLBACK_SERIES_COLORS[index]
  );
}

export function normaliseSeries(history) {
  const first = history.find((point) => Number.isFinite(point.v) && point.v > 0)?.v;
  if (!first) return [];
  return history.map((point) => ({ t: point.t, v: ((point.v - first) / first) * 100 }));
}

export function renderChart(canvas, series, options = {}) {
  if (!canvas) return;
  const usable = series.filter((item) => Array.isArray(item.points) && item.points.length > 0);
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  const styles = getComputedStyle(document.documentElement);
  const gridColor = styles.getPropertyValue('--chart-grid').trim() || '#dfe5df';
  const labelColor = styles.getPropertyValue('--chart-label').trim() || '#68736b';
  const seriesColors = getChartColors();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!usable.length) {
    ctx.fillStyle = labelColor;
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Ingen diagramdata tillgänglig', rect.width / 2, rect.height / 2);
    return;
  }

  const padding = { top: 18, right: 14, bottom: 30, left: 55 };
  const plotWidth = Math.max(1, rect.width - padding.left - padding.right);
  const plotHeight = Math.max(1, rect.height - padding.top - padding.bottom);
  const allPoints = usable.flatMap((item) => item.points);
  const minT = Math.min(...allPoints.map((point) => point.t));
  const maxT = Math.max(...allPoints.map((point) => point.t));
  let minV = Math.min(...allPoints.map((point) => point.v));
  let maxV = Math.max(...allPoints.map((point) => point.v));
  if (options.percent) {
    minV = Math.min(minV, 0);
    maxV = Math.max(maxV, 0);
  }
  const valuePadding = Math.max((maxV - minV) * 0.1, Math.abs(maxV || 1) * 0.02, 0.01);
  minV -= valuePadding;
  maxV += valuePadding;

  const xFor = (t) => padding.left + ((t - minT) / (maxT - minT || 1)) * plotWidth;
  const yFor = (v) => padding.top + (1 - (v - minV) / (maxV - minV || 1)) * plotHeight;

  ctx.font = '12px system-ui';
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i += 1) {
    const value = minV + ((maxV - minV) * i) / 4;
    const y = yFor(value);
    ctx.strokeStyle = gridColor;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(rect.width - padding.right, y);
    ctx.stroke();
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'right';
    ctx.fillText(options.percent ? formatPercent(value, 0) : compactValue(value), padding.left - 9, y);
  }

  ctx.textBaseline = 'top';
  for (let i = 0; i <= 3; i += 1) {
    const timestamp = minT + ((maxT - minT) * i) / 3;
    ctx.fillStyle = labelColor;
    ctx.textAlign = i === 0 ? 'left' : i === 3 ? 'right' : 'center';
    ctx.fillText(formatShortDate(timestamp), xFor(timestamp), rect.height - padding.bottom + 10);
  }

  usable.forEach((item, index) => {
    const color = item.color || seriesColors[index % seriesColors.length];
    if (usable.length === 1) {
      const gradient = ctx.createLinearGradient(0, padding.top, 0, rect.height - padding.bottom);
      gradient.addColorStop(0, `${color}2e`);
      gradient.addColorStop(1, `${color}00`);
      ctx.beginPath();
      item.points.forEach((point, pointIndex) => {
        const x = xFor(point.t);
        const y = yFor(point.v);
        if (pointIndex === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(xFor(item.points.at(-1).t), rect.height - padding.bottom);
      ctx.lineTo(xFor(item.points[0].t), rect.height - padding.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.beginPath();
    item.points.forEach((point, pointIndex) => {
      const x = xFor(point.t);
      const y = yFor(point.v);
      if (pointIndex === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = usable.length === 1 ? 2.5 : 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    const last = item.points.at(-1);
    ctx.beginPath();
    ctx.arc(xFor(last.t), yFor(last.v), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

function compactValue(value) {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0, notation: 'compact' }).format(value);
}
