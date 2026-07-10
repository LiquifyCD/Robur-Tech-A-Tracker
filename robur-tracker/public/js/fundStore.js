const FAVORITES_KEY = 'fondkoll:favorites';
const COMPARISON_KEY = 'fondkoll:comparison';
const CURRENT_KEY = 'fondkoll:current';
const MAX_FAVORITES = 30;
const MAX_COMPARISON = 3;

function read(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : value || fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function cleanFund(fund) {
  return {
    symbol: String(fund.symbol),
    name: String(fund.name || fund.symbol),
    currency: fund.currency || null,
    exchange: fund.exchange || null,
    isin: fund.isin || null,
  };
}

export const getFavorites = () => read(FAVORITES_KEY, []);
export const isFavorite = (symbol) => getFavorites().some((fund) => fund.symbol === symbol);

export function toggleFavorite(fund) {
  const favorites = getFavorites();
  const index = favorites.findIndex((item) => item.symbol === fund.symbol);
  const added = index < 0;
  if (added) favorites.unshift(cleanFund(fund));
  else favorites.splice(index, 1);
  write(FAVORITES_KEY, favorites.slice(0, MAX_FAVORITES));
  return added;
}

export const getComparison = () => read(COMPARISON_KEY, []);

export function addToComparison(fund) {
  const items = getComparison();
  if (items.some((item) => item.symbol === fund.symbol)) return { added: false, reason: 'exists' };
  if (items.length >= MAX_COMPARISON) return { added: false, reason: 'full' };
  items.push(cleanFund(fund));
  write(COMPARISON_KEY, items);
  return { added: true };
}

export function removeFromComparison(symbol) {
  write(COMPARISON_KEY, getComparison().filter((item) => item.symbol !== symbol));
}

export const setCurrentFund = (fund) => write(CURRENT_KEY, cleanFund(fund));
export const getCurrentFund = () => read(CURRENT_KEY, null);
