export function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('sv-SE', {
    style: 'percent',
    signDisplay: 'exceptZero',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100);
}

export function formatUnsignedPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('sv-SE', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100);
}

export function formatValue(value, currency) {
  if (!Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + (currency ? ` ${currency}` : '');
}

export function formatDate(iso) {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(iso) {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatPctPoints(value, digits = 2) {
  if (!Number.isFinite(value)) return '–';
  const formatted = new Intl.NumberFormat('sv-SE', {
    signDisplay: 'exceptZero',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted} pp`;
}

export function formatShortDate(timestamp) {
  return new Intl.DateTimeFormat('sv-SE', { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

export function freshnessLabel(ageHours, stale) {
  if (stale) return 'Inaktuell data';
  if (ageHours < 36) return 'Senaste bankdag';
  return 'Fördröjd data';
}

export function rangeLabel(range) {
  return ({ '1mo': 'en månad', '3mo': 'tre månader', ytd: 'i år', '1y': 'ett år', '5y': 'fem år', max: 'hela perioden' })[range] || range;
}
