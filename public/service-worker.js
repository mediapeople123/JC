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

const CACHE_NAME = 'dg-church-v2';

// Files to pre-cache on install
const PRECACHE_URLS = ['/', '/styles.css', '/app.js', '/report', '/report.css', '/report.js'];

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
  // iOS sometimes sends non-JSON payload — always use try/catch
  let data = {
    title: 'DG Jesus Church',
    body: "It's time to submit your DG report!",
    url: self.location.origin + '/report',
  };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Fallback: use text payload as body
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body:               data.body,
    icon:               '/icon-192.png',
    badge:              '/icon-192.png',
    vibrate:            [200, 100, 200],
    requireInteraction: false,
    data:               { url: data.url || self.location.origin },
  };

  // Badging API — shows a dot/number on the app icon (iOS 16.4+, Android)
  const badgePromise = self.navigator?.setAppBadge
    ? self.navigator.setAppBadge(1).catch(() => {})
    : Promise.resolve();

  // CRITICAL for iOS: event.waitUntil MUST include showNotification.
  // If a push event fires without showing a notification, iOS will
  // eventually revoke the push subscription.
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, options),
      badgePromise,
    ])
  );
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Clear the badge when user interacts with a notification
  if (self.navigator?.clearAppBadge) {
    self.navigator.clearAppBadge().catch(() => {});
  }

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
