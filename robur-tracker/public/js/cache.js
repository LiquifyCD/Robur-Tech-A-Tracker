/**
 * cache.js
 * ---------------------------------------------------------------------------
 * Thin wrapper around localStorage that adds:
 *   - TTL (time-to-live) expiry
 *   - JSON-safe get/set
 *   - a "stale read" helper so callers can fall back to expired data when a
 *     network request fails (holdings retrieval, quote retrieval, etc.)
 *
 * All keys are namespaced with a prefix so this app never collides with
 * other localStorage usage on the same origin.
 * ---------------------------------------------------------------------------
 */

const PREFIX = 'robur-tracker:';

/**
 * Store a value with an optional TTL (milliseconds).
 * @param {string} key
 * @param {*} value - any JSON-serialisable value
 * @param {number} [ttlMs] - if omitted, the value never expires on its own
 */
function set(key, value, ttlMs) {
  const record = {
    value,
    storedAt: Date.now(),
    expiresAt: ttlMs ? Date.now() + ttlMs : null,
  };
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(record));
    return true;
  } catch (err) {
    // Quota exceeded or storage disabled (private browsing, etc.)
    console.warn('[cache] Failed to write key', key, err);
    return false;
  }
}

/**
 * Retrieve a value. Returns null if missing or expired, unless
 * allowStale is true, in which case expired values are still returned
 * (with a `stale: true` flag inside the returned envelope).
 * @param {string} key
 * @param {{allowStale?: boolean}} [options]
 * @returns {{value:*, storedAt:number, stale:boolean}|null}
 */
function get(key, options = {}) {
  const { allowStale = false } = options;
  let raw;
  try {
    raw = window.localStorage.getItem(PREFIX + key);
  } catch (err) {
    return null;
  }
  if (!raw) return null;

  let record;
  try {
    record = JSON.parse(raw);
  } catch (err) {
    // Corrupted entry - clean it up.
    remove(key);
    return null;
  }

  const isExpired = record.expiresAt !== null && Date.now() > record.expiresAt;
  if (isExpired && !allowStale) return null;

  return {
    value: record.value,
    storedAt: record.storedAt,
    stale: isExpired,
  };
}

function remove(key) {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch (err) {
    /* ignore */
  }
}

function clearAll() {
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch (err) {
    /* ignore */
  }
}

export const cache = { set, get, remove, clearAll };
