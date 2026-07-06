/**
 * chart.js
 * ---------------------------------------------------------------------------
 * A tiny, dependency-free canvas line chart for the intraday estimated
 * fund value. Deliberately avoids pulling in a charting library to keep
 * the JS bundle minimal (per the "Performance" requirement) - this is
 * ~100 lines and does exactly what this app needs.
 *
 * Points are kept in-memory for the session (sessionStorage-backed so a
 * refresh doesn't lose today's chart). Each point is
 * { t: timestamp, v: estimatedChangePct }.
 * ---------------------------------------------------------------------------
 */

const SESSION_KEY = 'robur-tracker:intraday-points';
const MAX_POINTS = 2000; // ~8 hours at 15s intervals, plenty of headroom

let points = loadPoints();

function loadPoints() {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Discard points from a previous day so the chart resets daily.
    const today = new Date().toDateString();
    return parsed.filter((p) => new Date(p.t).toDateString() === today);
  } catch (err) {
    return [];
  }
}

function persistPoints() {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(points));
  } catch (err) {
    /* ignore - non-critical */
  }
}

/**
 * Record a new data point for the intraday chart.
 * @param {number} estimatedChangePct
 */
export function addPoint(estimatedChangePct) {
  points.push({ t: Date.now(), v: estimatedChangePct });
  if (points.length > MAX_POINTS) points.shift();
  persistPoints();
}

/**
 * Render the chart into the given canvas element.
 * @param {HTMLCanvasElement} canvas
 */
export function render(canvas) {
  if (!canvas || points.length < 2) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const padding = 8;

  ctx.clearRect(0, 0, width, height);

  const values = points.map((p) => p.v);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;

  const xFor = (i) => padding + (i / (points.length - 1)) * (width - padding * 2);
  const yFor = (v) => height - padding - ((v - min) / range) * (height - padding * 2);

  // Zero line
  const styles = getComputedStyle(canvas);
  const gridColor = styles.getPropertyValue('--chart-grid').trim() || '#33415580';
  const lineColor =
    values[values.length - 1] >= 0
      ? styles.getPropertyValue('--positive').trim() || '#22c55e'
      : styles.getPropertyValue('--negative').trim() || '#ef4444';
  const fillColor = lineColor + '26'; // ~15% opacity hex suffix

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padding, yFor(0));
  ctx.lineTo(width - padding, yFor(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Filled area under the line
  ctx.beginPath();
  ctx.moveTo(xFor(0), yFor(values[0]));
  values.forEach((v, i) => ctx.lineTo(xFor(i), yFor(v)));
  ctx.lineTo(xFor(values.length - 1), yFor(0));
  ctx.lineTo(xFor(0), yFor(0));
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  // The line itself
  ctx.beginPath();
  ctx.moveTo(xFor(0), yFor(values[0]));
  values.forEach((v, i) => ctx.lineTo(xFor(i), yFor(v)));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Current-value dot
  const lastIdx = values.length - 1;
  ctx.beginPath();
  ctx.arc(xFor(lastIdx), yFor(values[lastIdx]), 3.5, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();
}

export function clear() {
  points = [];
  persistPoints();
}

export function getPoints() {
  return points;
}
