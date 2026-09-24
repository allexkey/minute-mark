// Service worker template; vite.config.js fills in the version and file list at build time.
const VERSION = '__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const shell = new URL('./', self.registration.scope);
  if (req.mode === 'navigate') {
    // Only the app's own page gets the cached shell; other pages in scope (e.g. /spike/) go to the network.
    const isApp = url.pathname === shell.pathname || url.pathname === `${shell.pathname}index.html`;
    if (!isApp) return;
    event.respondWith(caches.match(shell.href).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
