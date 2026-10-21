const CACHE = 'gemeinsam-shell-firebase-v1';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './firebase-backend.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

const EXTERNAL = [
  'https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js',
  'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    await Promise.allSettled(EXTERNAL.map(async url => {
      try {
        const response = await fetch(url, {cache: 'reload'});
        if (response.ok) await cache.put(url, response.clone());
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Firebase-Daten und Authentifizierung niemals aus dem App-Shell-Cache bedienen.
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken')
  ) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Eigene Dateien: network-first, damit GitHub-Pages-Updates schnell ankommen.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            caches.open(CACHE).then(c => c.put(event.request, response.clone())).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Bibliotheken vom CDN: cache-first, danach Netz und anschließend cachen.
  event.respondWith(
    caches.match(event.request).then(async cached => {
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response && response.ok) {
        caches.open(CACHE).then(c => c.put(event.request, response.clone())).catch(() => {});
      }
      return response;
    })
  );
});
