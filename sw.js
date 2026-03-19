// Market Radar v2 — Service Worker
// Minimal: notifications only. No caching (cache-busting via ?v=N handles freshness).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

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
