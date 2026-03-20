// Market Radar v2.1 — Smart Service Worker
// Network-first with versioned cache. Bump CACHE_VERSION on every push.
// localStorage is NEVER affected by cache operations.

const CACHE_VERSION = 'mr-v26';

// Install: skip waiting immediately so new SW takes over
self.addEventListener('install', event => {
    self.skipWaiting();
});

// Activate: delete ALL old caches, claim clients immediately
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => {
                console.log('[SW] Deleting old cache:', k);
                return caches.delete(k);
            }))
        ).then(() => self.clients.claim())
    );
});

// Fetch: NETWORK FIRST, always. Cache for offline fallback only.
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    // Only handle same-origin requests (not Supabase, Upstox API, fonts etc.)
    if (!event.request.url.startsWith(self.location.origin)) return;

    event.respondWith(
        fetch(event.request, {
            // Force revalidation — bypass browser HTTP cache for HTML
            cache: event.request.url.includes('.html') || event.request.url.endsWith('/MarketVivi/')
                ? 'no-cache' : 'default'
        })
        .then(response => {
            if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
            }
            return response;
        })
        .catch(() => {
            // Offline fallback
            return caches.match(event.request);
        })
    );
});

// Notification click — focus app window
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(list => {
            for (const client of list) {
                if (client.url.includes('MarketVivi') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow('/MarketVivi/');
        })
    );
});
