// Minimal service worker: exists so the browser offers "Install app".
// Reader is a live API-backed UI; every request goes to the network and
// offline support is a later milestone, so this never serves cached bodies.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
