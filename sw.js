const cacheName = "orxelia-shell-v54";
const files = ["./", "index.html", "style.css?v=54", "app.js?v=54", "manifest.webmanifest", "mark.svg", "apple.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("orxelia-shell-") && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
const urls = new Set(files.map(file => new URL(file, self.registration.scope).href));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const scope = new URL(self.registration.scope);
  const target = new URL(event.request.url);
  if (event.request.mode === "navigate" && target.origin === scope.origin &&
      (target.pathname === scope.pathname || target.pathname === scope.pathname + "index.html")) {
    event.respondWith(fetch(event.request).catch(async () =>
      (await caches.open(cacheName)).match(scope.href)
    ));
    return;
  }
  if (!urls.has(event.request.url)) return;
  event.respondWith(caches.open(cacheName).then(async cache =>
    (await cache.match(event.request)) || fetch(event.request)
  ));
});






