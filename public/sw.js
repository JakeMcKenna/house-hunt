// Minimal service worker so the app can be installed to the home screen.
// No caching and no fetch handler: the app always loads from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
