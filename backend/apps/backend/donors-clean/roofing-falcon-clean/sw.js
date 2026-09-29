/* Minimal service worker: cache-first for immutable build assets (/assets, /media)
   with a tiny inline offline fallback for navigations. Fails safe everywhere —
   any error falls through to the network and never throws to the page. */
var CACHE = "mirror-static-v2";
var OFFLINE_HTML =
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
  "<title>Offline</title>" +
  "<style>body{font-family:system-ui,sans-serif;background:#16181c;color:#f5f2ec;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px}main{max-width:26rem}h1{font-size:1.4rem;margin:0 0 .5rem}p{opacity:.75;line-height:1.5}</style>" +
  "</head><body><main><h1>You're offline</h1>" +
  "<p>This page isn't available without a connection. Reconnect and try again.</p>" +
  "</main></body></html>";

self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
      .catch(function () {})
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, inline offline page as the fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(function () {
        return new Response(OFFLINE_HTML, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      })
    );
    return;
  }

  // Hashed build assets + donor media: cache-first, populate on miss.
  if (url.pathname.indexOf("/assets/") === 0 || url.pathname.indexOf("/media/") === 0) {
    event.respondWith(
      caches
        .match(req)
        .then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok && (res.type === "basic" || res.type === "default")) {
              var copy = res.clone();
              caches
                .open(CACHE)
                .then(function (c) { return c.put(req, copy); })
                .catch(function () {});
            }
            return res;
          });
        })
        .catch(function () { return fetch(req); })
    );
  }
});
