const cacheName = "orxelia-shell-v1";
const files = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "mark.svg", "apple.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("orxelia-shell-") && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
const urls = new Set(files.map(file => new URL(file, self.registration.scope).href));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !urls.has(event.request.url)) return;
  event.respondWith(caches.open(cacheName).then(async cache =>
    (await cache.match(event.request)) || fetch(event.request)
  ));
});
