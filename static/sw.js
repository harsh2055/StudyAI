// Service Worker stub — no offline caching needed for dev
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
