// WSS Connect service worker — network-first for the app shell so updates always show.
const CACHE = "wss-connect-v8";
const SHELL_ASSETS = [
  "/",
  "/manifest.json",
  "/wss-app-icon.svg",
  "/wss-connect-icon-192.png",
  "/wss-connect-icon-512.png",
  "/wss-connect-maskable-512.png",
  "/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never inspect, store, or replay authenticated API requests. The page owns
  // the authenticated reply queue.
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never touch data
  // Network-first for navigation so the newest app always loads. Cache each
  // route under its own key so /privacy or /terms can never replace the shell.
  if (e.request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        return caches.open(CACHE).then((c) => c.put(e.request, copy)).then(() => res);
      }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/"))));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});

function pushText(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function pushThreadId(value) {
  const text = String(value == null ? "" : value).trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(text) ? text : "";
}

self.addEventListener("push", (e) => {
  let payload = {};
  if (e.data) {
    try { payload = e.data.json() || {}; }
    catch (_) { payload = { body: e.data.text() }; }
  }
  const sender = pushText(payload.senderName || payload.sender, 60);
  const title = pushText(payload.title, 80) || (sender ? `New message from ${sender}` : "New message in WSS Connect");
  const body = pushText(payload.body || payload.snippet, 120) || "Open WSS Connect to read it.";
  const threadId = pushThreadId(payload.threadId);
  const destination = threadId ? `/#thread=${encodeURIComponent(threadId)}` : "/";
  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/wss-connect-icon-192.png",
    badge: "/wss-connect-icon-192.png",
    tag: threadId ? `wss-connect-thread-${threadId}` : "wss-connect-message",
    renotify: Boolean(threadId),
    data: { threadId, destination }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const threadId = pushThreadId(data.threadId);
  const target = new URL(threadId ? `/#thread=${encodeURIComponent(threadId)}` : "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const ownWindow = windows.find((client) => {
      try { return new URL(client.url).origin === self.location.origin; }
      catch (_) { return false; }
    });
    if (ownWindow) {
      if ("navigate" in ownWindow) {
        const navigated = await ownWindow.navigate(target);
        if (navigated) return navigated.focus();
      }
      return ownWindow.focus();
    }
    return self.clients.openWindow(target);
  }));
});
