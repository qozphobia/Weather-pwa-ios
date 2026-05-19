const CACHE_NAME = "daily-app-v1";
const ASSETS = [ "/Weather-pwa-ios/weather-app/",
  "/Weather-pwa-ios/weather-app/index.html",
  "/Weather-pwa-ios/weather-app/style.css",
  "/Weather-pwa-ios/weather-app/app.js",
  "/Weather-pwa-ios/weather-app/manifest.json"];

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
