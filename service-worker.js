/* Revival service worker — bump CACHE_VERSION on every deploy. */

const CACHE_VERSION = 'revival-v1';
const CACHE_PREFIX  = 'revival-';

// App shell — the minimum needed to render offline
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Apps Script Web App URL (reads = network-first, writes = pass-through)
const APPS_SCRIPT_HOST = 'script.google.com';

// Network-first read cache TTL (ms) — fall back to cached response when stale
const READ_TTL_MS = 5 * 60 * 1000;
const READ_CACHE  = CACHE_VERSION + ':reads';

// ----------------------------------------------------------------------------
// Install — pre-cache app shell + skip waiting so updates land on next nav
// ----------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ----------------------------------------------------------------------------
// Activate — drop any old `revival-*` caches that aren't current
// ----------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k.startsWith(CACHE_PREFIX) && !k.startsWith(CACHE_VERSION))
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ----------------------------------------------------------------------------
// Fetch routing
//   - Apps Script POST  → network-only, never cache
//   - Apps Script GET   → network-first (5min cache fallback)
//   - Same-origin shell → cache-first, fall through to network
//   - Anything else     → bypass (let the browser handle it)
// ----------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Apps Script writes — never cache, never intercept (no-cors POSTs from app)
  if (url.host === APPS_SCRIPT_HOST && req.method !== 'GET') {
    return;   // pass-through to network
  }

  // Apps Script reads — network-first with short TTL
  if (url.host === APPS_SCRIPT_HOST && req.method === 'GET') {
    event.respondWith(networkFirstWithTtl(req));
    return;
  }

  // Same-origin app shell — cache-first
  if (url.origin === self.location.origin && req.method === 'GET') {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Everything else — let the browser do its thing
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    // Offline + nothing cached — return the cached shell index as a last resort
    const fallback = await cache.match('./index.html');
    return fallback || new Response('Offline', { status: 503 });
  }
}

async function networkFirstWithTtl(req) {
  const cache = await caches.open(READ_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const stamped = new Response(fresh.clone().body, {
        status: fresh.status,
        statusText: fresh.statusText,
        headers: appendStamp(fresh.headers)
      });
      cache.put(req, stamped);
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached && !isStale(cached)) return cached;
    if (cached) return cached;   // stale but better than nothing offline
    throw err;
  }
}

function appendStamp(headers) {
  const h = new Headers(headers);
  h.set('x-revival-cached-at', String(Date.now()));
  return h;
}

function isStale(response) {
  const stamp = parseInt(response.headers.get('x-revival-cached-at') || '0', 10);
  if (!stamp) return true;
  return (Date.now() - stamp) > READ_TTL_MS;
}
