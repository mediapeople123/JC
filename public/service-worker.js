/**
 * DG Jesus Church — Service Worker
 *
 * Responsibilities:
 *  1. Pre-cache app shell so the page loads offline.
 *  2. Receive push events and show native notifications.
 *  3. Handle notification clicks (open or focus the app).
 *
 * NOTE: This file is served with Cache-Control: no-cache (see netlify.toml)
 * so updates are picked up immediately by the browser.
 */

const CACHE_NAME = 'dg-church-v1';

// Files to pre-cache on install
const PRECACHE_URLS = ['/', '/styles.css', '/app.js'];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates immediately
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch (network-first; fall back to cache) ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Skip API calls — never cache them
  if (event.request.url.includes('/api/') || event.request.url.includes('/.netlify/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Push ──────────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {
    title: 'DG Jesus Church',
    body: 'You have a new notification.',
    url: self.location.origin,
  };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // If parsing fails, use defaults
  }

  const options = {
    body:             data.body,
    icon:             '/icon-192.png',   // add a 192×192 PNG to /public if desired
    badge:            '/badge-96.png',   // add a 96×96 monochrome PNG if desired
    vibrate:          [200, 100, 200],
    requireInteraction: false,
    data:             { url: data.url },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || self.location.origin;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // If we already have a window open at that URL, just focus it
        const existing = windowClients.find(
          (c) => c.url === targetUrl && 'focus' in c
        );
        if (existing) return existing.focus();

        // Otherwise open a new window
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});
