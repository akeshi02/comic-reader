// sw.js
// Caches the app shell (HTML/CSS/JS + pdf.js from the CDN + icons) so the
// app itself loads without a network connection and can be installed as
// a PWA. This is separate from js/blob-store.js, which caches comic PDF
// bytes in IndexedDB — this worker only ever touches the app's own code
// and static assets, never Drive API responses, so it can't go stale in
// a way that blocks reading a comic or go stale in a way that requires
// re-authenticating with Drive.

const CACHE_VERSION = 'v5';
const CACHE_NAME = `gutter-shell-${CACHE_VERSION}`;

// Paths are resolved relative to this file's own scope, so this works
// whether the app is served at a domain root or under a GitHub Pages
// subpath like /username/repo/.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/drive-api.js',
  './js/library.js',
  './js/blob-store.js',
  './js/pdf-reader.js',
  './js/supabase-sync.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // If precaching fails (e.g. offline on first install), don't hard-fail
        // the install — the app can still cache assets opportunistically on
        // first successful fetch via the fetch handler below.
        console.warn('Gutter SW: precache failed', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for shell assets (they're versioned by CACHE_NAME, so a new
// deploy gets a fresh cache rather than serving stale code indefinitely).
// Everything else — Drive API calls in particular — is left untouched and
// goes straight to the network, since those need real-time auth/CORS
// handling that this worker shouldn't interfere with.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  const isShellAsset = SHELL_ASSETS.some((path) => {
    try {
      return new URL(path, self.registration.scope).href === url.href;
    } catch {
      return false;
    }
  });
  if (!isShellAsset) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })()
  );
});
