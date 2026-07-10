/**
 * Worker entry point.
 * ---------------------------------------------------------------------------
 * Serves the static app and routes the deliberately small fund-data API.
 * Response security headers are applied centrally to every static asset.
 * ---------------------------------------------------------------------------
 */

import { onRequestGet as fundHandler } from '../functions/api/fund.js';
import { onRequestGet as fundsHandler } from '../functions/api/funds.js';

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/fund') {
      return fundHandler({ request, env, ctx });
    }
    if (url.pathname === '/api/funds') {
      return fundsHandler({ request, env, ctx });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    // Anything else falls through to the static assets binding
    // (index.html, css/, js/).
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    Object.entries(SECURITY_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      response.headers.set('Cache-Control', 'no-cache');
    }
    return response;
  },
};
