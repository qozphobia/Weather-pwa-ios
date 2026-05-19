const CACHE_NAME = "daily-app-v1";
const ASSETS = ["/Weather-pwa-ios/", "/Weather-pwa-ios/index.html", "/Weather-pwa-ios/style.css", "/Weather-pwa-ios/app.js", "/Weather-pwa-ios/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
