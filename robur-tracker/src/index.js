/**
 * Worker entry point.
 * ---------------------------------------------------------------------------
 * This project was originally written for Cloudflare Pages Functions
 * (file-based routing under functions/api/*.js). That only works when the
 * project is deployed as a Pages project - a plain Worker deploy ignores
 * the functions/ folder entirely, which is why /api/holdings and
 * /api/quotes were 404ing.
 *
 * This file turns the project into a single Worker: it serves the static
 * site (index.html, css/, js/) via the Workers Static Assets binding, and
 * manually routes the three /api/* paths to the exact same handler logic
 * that used to live in functions/api/*.js (those files are untouched and
 * re-exported from here, so nothing about how they fetch/parse/cache data
 * has changed).
 * ---------------------------------------------------------------------------
 */

import { onRequestGet as holdingsHandler } from '../functions/api/holdings.js';
import { onRequestGet as quotesHandler } from '../functions/api/quotes.js';
import { onRequestGet as fxHandler } from '../functions/api/fx.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/holdings') {
      return holdingsHandler({ request, env, ctx });
    }
    if (url.pathname === '/api/quotes') {
      return quotesHandler({ request, env, ctx });
    }
    if (url.pathname === '/api/fx') {
      return fxHandler({ request, env, ctx });
    }

    // Anything else falls through to the static assets binding
    // (index.html, css/, js/).
    return env.ASSETS.fetch(request);
  },
};
