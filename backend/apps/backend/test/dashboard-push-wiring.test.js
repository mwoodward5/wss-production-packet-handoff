"use strict";

// THE PHONE MUST ACTUALLY BUZZ.
//
// Before this file, every piece of Connect push existed and none of them were
// connected: lib/connect-push.js signed and encrypted a correct RFC 8291/8292
// message, api/connect/push-subscribe.js stored endpoints, apps/labs-site had
// a manifest and a service worker on disk — and dashboard/index.html
// referenced NONE of it. The live page (fetched 2026-08-11) contained zero
// occurrences of "manifest" or "serviceWorker", and wss-ai.com's
// /api/connect/push-subscribe answered 404 because labs-site/vercel.json had
// no rewrite for it. A customer could not have turned alerts on if they tried.
//
// So these tests do not grep for hopeful strings. They RUN the dashboard's own
// script against a fake DOM and a stubbed browser, click the button a customer
// would click, and read what came out; and they RUN the service worker and
// fire a real push event at it to see what notification it shows and where a
// tap on it lands.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SITE_DIR = path.resolve(__dirname, "../../labs-site");
const DASHBOARD = path.join(SITE_DIR, "dashboard/index.html");
const MANIFEST = path.join(SITE_DIR, "dashboard/manifest.webmanifest");
const WORKER = path.join(SITE_DIR, "sw.js");
const VERCEL = path.join(SITE_DIR, "vercel.json");

const html = fs.readFileSync(DASHBOARD, "utf8");
const workerSource = fs.readFileSync(WORKER, "utf8");

const THREADS = [
  { id: 1, contact_name: "Alpha Lead", channel: "chat", unread: true, last_message_at: "2026-08-11T09:00:00Z" },
  { id: 2, contact_name: "Beta Lead", channel: "sms", unread: false, last_message_at: "2026-08-10T09:00:00Z" },
];

const VAPID_PUBLIC = require("node:crypto")
  .createECDH("prime256v1");
VAPID_PUBLIC.generateKeys();
const PUBLIC_KEY = VAPID_PUBLIC.getPublicKey(null, "uncompressed").toString("base64url");

const SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/proof-endpoint",
  keys: { p256dh: PUBLIC_KEY, auth: Buffer.alloc(16, 7).toString("base64url") },
};

/**
 * Runs the dashboard's inline script in a fresh realm with a DOM that records
 * real event listeners and a browser stub that records every push API call, so
 * a test can press the button a customer presses.
 */
async function bootDashboard({
  permission = "default",
  pushConfig = { ok: true, configured: true, publicKey: PUBLIC_KEY, scope: "tenant" },
  pushConfigStatus = 200,
  existingSubscription = null,
  subscribeFails = null,
  hash = "",
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/143",
  hasPushManager = true,
} = {}) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(script, "the dashboard must keep its inline script");

  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        innerHTML: "",
        textContent: "",
        value: "",
        style: {},
        tabIndex: 0,
        hidden: false,
        className: "",
        listeners: {},
        classList: { add() {}, remove() {} },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        setAttribute(name, value) { this[name] = String(value); },
        querySelectorAll() { return []; },
        focus() {},
        remove() {},
      });
    }
    return elements.get(id);
  };
  const click = (id) => {
    const handlers = element(id).listeners.click || [];
    assert.ok(handlers.length, `#${id} must have a click handler`);
    handlers.forEach((fn) => fn({ currentTarget: element(id), preventDefault() {} }));
  };

  const calls = [];
  const permissionAsks = [];
  const subscribeCalls = [];
  const unsubscribed = [];
  const registrations = [];

  const answer = (body, status = 200) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

  let currentSubscription = existingSubscription;
  const pushManager = {
    getSubscription: () => Promise.resolve(currentSubscription),
    subscribe(options) {
      subscribeCalls.push(options);
      if (subscribeFails) return Promise.reject(new Error(subscribeFails));
      currentSubscription = {
        ...SUBSCRIPTION,
        toJSON: () => SUBSCRIPTION,
        unsubscribe: () => { unsubscribed.push(true); return Promise.resolve(true); },
      };
      return Promise.resolve(currentSubscription);
    },
  };

  const sandbox = {
    console,
    setTimeout,
    Promise,
    atob: (value) => Buffer.from(String(value), "base64").toString("binary"),
    fetch(url, options) {
      calls.push({ url: String(url), options: options || {} });
      const key = String(url).split("?")[0];
      if (key === "/api/connect/push-subscribe") {
        return answer(pushConfig, (options && options.method === "POST") ? 200 : pushConfigStatus);
      }
      if (key === "/api/connect/threads") return answer({ ok: true, threads: THREADS, summary: { unrepliedCount: 1 } });
      if (key === "/api/connect/messages") return answer({ ok: true, messages: [] });
      if (key === "/api/connect/send") return answer({ ok: true });
      if (key === "/api/connect/site") return answer({ ok: true, businessName: "Proof Co", site: { available: false }, report: { available: false } });
      if (key === "/api/connect/visibility") return answer({ ok: true, configured: true, points: [], latest: null });
      return answer({ ok: true }, 200);
    },
    document: { getElementById: (id) => element(id) },
    localStorage: {
      store: new Map(),
      getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
      setItem(k, v) { this.store.set(k, String(v)); },
      removeItem(k) { this.store.delete(k); },
    },
    location: { hash, pathname: "/dashboard" },
    history: { replaceState() {} },
    matchMedia: () => ({ matches: false }),
    navigator: {
      userAgent,
      platform: "Win32",
      maxTouchPoints: 0,
      serviceWorker: {
        register(url) { registrations.push(String(url)); return Promise.resolve({ pushManager }); },
        ready: Promise.resolve({ pushManager }),
      },
    },
    Notification: {
      permission,
      requestPermission() {
        permissionAsks.push(true);
        return Promise.resolve(permission === "default" ? "granted" : permission);
      },
    },
    crypto: { subtle: { digest: () => Promise.reject(new Error("not used on the boot path")) } },
    TextEncoder, TextDecoder,
  };
  const windowListeners = {};
  sandbox.window = {
    PushManager: hasPushManager ? function PushManager() {} : undefined,
    isSecureContext: true,
    addEventListener(type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn); },
  };
  if (!hasPushManager) delete sandbox.window.PushManager;
  sandbox.localStorage.setItem("wss_connect_token", "tenant-token-for-this-test");

  vm.runInNewContext(script[1], sandbox);
  const settle = async () => { for (let i = 0; i < 60; i += 1) await new Promise((r) => setImmediate(r)); };
  await settle();

  return {
    el: element,
    click,
    settle,
    /** Simulates the service worker's client.navigate() on an open window. */
    async hashTo(hash) {
      sandbox.location.hash = hash;
      for (const fn of windowListeners.hashchange || []) fn({});
      await settle();
    },
    calls,
    pushCalls: () => calls.filter((c) => c.url.split("?")[0] === "/api/connect/push-subscribe"),
    permissionAsks,
    subscribeCalls,
    unsubscribed,
    registrations,
  };
}

// ---------------------------------------------------------------------------
// The page has to be a real installable app that owns a worker
// ---------------------------------------------------------------------------

test("the dashboard links a manifest and registers the service worker", async () => {
  assert.match(html, /<link\s+rel="manifest"\s+href="\/dashboard\/manifest\.webmanifest">/,
    "no manifest link means no install prompt and no home-screen app");
  const boot = await bootDashboard();
  assert.deepEqual(boot.registrations, ["/sw.js"],
    "the page must register /sw.js — without an active worker there is nothing for a push to wake");
});

test("the manifest is installable: name, standalone, theme, and icons that exist", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/dashboard");
  assert.equal(manifest.scope, "/dashboard");
  assert.ok(manifest.name && manifest.short_name, "an installed icon needs a name under it");
  assert.ok(manifest.short_name.length <= 12, "short_name is what fits under a home-screen icon");
  // Light is the dashboard's default now (the owner's "this is like too dark"
  // call), so the installed app's splash matches the light canvas.
  assert.equal(manifest.theme_color, "#F4F4F7");
  assert.equal(manifest.background_color, "#F4F4F7");

  const sizes = new Set(manifest.icons.map((icon) => icon.sizes));
  assert.ok(sizes.has("192x192"), "192px is required for installability");
  assert.ok(sizes.has("512x512"), "512px is required for installability");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"),
    "without a maskable icon Android crops the mark into a white circle");

  for (const icon of manifest.icons) {
    const file = path.join(SITE_DIR, icon.src.replace(/^\//, ""));
    assert.ok(fs.existsSync(file), `${icon.src} is declared in the manifest but not on disk`);
    assert.ok(fs.statSync(file).size > 512, `${icon.src} is too small to be a real icon`);
  }

  // Every shortcut must land somewhere the page actually routes to.
  for (const shortcut of manifest.shortcuts || []) {
    assert.match(shortcut.url, /^\/dashboard(#tab=(overview|leads|calls|assistant|reports))?$/,
      `manifest shortcut ${shortcut.url} points somewhere the page does not route`);
  }
});

test("the site can reach the subscribe endpoint at all", () => {
  // The live page 404'd here: wss-ai.com/api/connect/push-subscribe had no
  // rewrite, so even a perfectly wired page could not have registered a device.
  const config = JSON.parse(fs.readFileSync(VERCEL, "utf8"));
  const rewrite = config.rewrites.find((r) => r.source === "/api/connect/push-subscribe");
  assert.ok(rewrite, "/api/connect/push-subscribe must be proxied to the backend");
  assert.equal(rewrite.destination, "https://ghost-agency-backend.vercel.app/api/connect/push-subscribe");
  const swHeaders = config.headers.find((h) => h.source === "/sw.js");
  assert.ok(swHeaders, "the worker needs its own cache header or an update can never land");
  assert.ok(swHeaders.headers.some((h) => h.key === "Cache-Control" && /no-cache/.test(h.value)));
});

// ---------------------------------------------------------------------------
// Permission is asked at a sensible moment, never on load
// ---------------------------------------------------------------------------

test("loading the dashboard never prompts for notifications", async () => {
  const boot = await bootDashboard();
  assert.equal(boot.permissionAsks.length, 0,
    "a prompt on load is how an origin gets blocked once and permanently");
  assert.equal(boot.pushCalls().length, 0, "nothing push-related should touch the network on load");
  assert.equal(boot.el("pushcard").innerHTML, "", "the offer belongs in Leads, not on the landing view");
});

test("opening Leads offers alerts, and only a click asks the browser", async () => {
  const boot = await bootDashboard();
  boot.click("tab-leads");
  await boot.settle();

  const card = boot.el("pushcard").innerHTML;
  assert.match(card, /Never miss a new lead/);
  assert.match(card, /id="notifybtn"/);
  assert.doesNotMatch(card, /disabled/, "the key arrived, so the button must be live");
  assert.equal(boot.permissionAsks.length, 0, "showing the offer is not asking");
  assert.equal(boot.pushCalls().length, 1, "the tab read the VAPID key exactly once");
  assert.equal(boot.pushCalls()[0].options.method, "GET");
});

test("clicking through subscribes the device and files it under this tenant", async () => {
  const boot = await bootDashboard();
  boot.click("tab-leads");
  await boot.settle();
  boot.click("notifybtn");
  await boot.settle();

  assert.equal(boot.permissionAsks.length, 1, "the click must be what asks");
  assert.equal(boot.subscribeCalls.length, 1);
  assert.equal(boot.subscribeCalls[0].userVisibleOnly, true,
    "userVisibleOnly:false is rejected by every browser that matters");
  const key = boot.subscribeCalls[0].applicationServerKey;
  assert.equal(key.length, 65, "the application server key must be the 65-byte uncompressed point");
  assert.equal(key[0], 4);

  const posted = boot.pushCalls().find((c) => c.options.method === "POST");
  assert.ok(posted, "the subscription must reach the server, or the device is registered nowhere");
  assert.equal(posted.options.headers["x-connect-token"], "tenant-token-for-this-test");
  assert.deepEqual(JSON.parse(posted.options.body), { subscription: SUBSCRIPTION });

  assert.match(boot.el("pushcard").innerHTML, /Phone alerts are on/);
});

test("a device that already granted permission is re-filed under the business signed in now", async () => {
  const existing = { ...SUBSCRIPTION, toJSON: () => SUBSCRIPTION };
  const boot = await bootDashboard({ permission: "granted", existingSubscription: existing });
  boot.click("tab-leads");
  await boot.settle();

  const posted = boot.pushCalls().find((c) => c.options.method === "POST");
  assert.ok(posted, "an endpoint filed under a previous tenant would receive nothing");
  assert.equal(boot.permissionAsks.length, 0, "already-granted must not re-prompt");
  assert.match(boot.el("pushcard").innerHTML, /Phone alerts are on/);
});

// ---------------------------------------------------------------------------
// When it cannot work, it says so instead of offering a dead button
// ---------------------------------------------------------------------------

test("no VAPID keys on the server means an honest message, not a button that always fails", async () => {
  const boot = await bootDashboard({ pushConfig: { ok: true, configured: false, publicKey: null, scope: "tenant" } });
  boot.click("tab-leads");
  await boot.settle();

  const card = boot.el("pushcard").innerHTML;
  assert.match(card, /couldn’t be switched on/);
  assert.doesNotMatch(card, /id="notifybtn"/, "there is nothing to retry without a key");
  assert.equal(boot.permissionAsks.length, 0);
});

test("a full-access token cannot claim a device", async () => {
  const boot = await bootDashboard({ pushConfig: { ok: true, configured: true, publicKey: PUBLIC_KEY, scope: "full" } });
  boot.click("tab-leads");
  await boot.settle();
  assert.match(boot.el("pushcard").innerHTML, /Open your own business link/);
  assert.doesNotMatch(boot.el("pushcard").innerHTML, /id="notifybtn"/);
});

test("a blocked browser is told the truth and never re-prompted", async () => {
  const boot = await bootDashboard({ permission: "denied" });
  boot.click("tab-leads");
  await boot.settle();
  assert.match(boot.el("pushcard").innerHTML, /Notifications are blocked/);
  assert.equal(boot.pushCalls().length, 0, "a denied origin should not even fetch the key");
});

test("iPhone Safari is told to install first, because that is the only way it can work", async () => {
  const boot = await bootDashboard({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari" });
  boot.click("tab-leads");
  await boot.settle();
  assert.match(boot.el("pushcard").innerHTML, /Add this to your Home Screen first/);
  assert.equal(boot.permissionAsks.length, 0);
});

test("a failed subscribe does not leave a live endpoint the server never recorded", async () => {
  const boot = await bootDashboard({ subscribeFails: "AbortError" });
  boot.click("tab-leads");
  await boot.settle();
  boot.click("notifybtn");
  await boot.settle();
  assert.equal(boot.pushCalls().filter((c) => c.options.method === "POST").length, 0);
  assert.match(boot.el("pushcard").innerHTML, /couldn’t be switched on/);
});

// ---------------------------------------------------------------------------
// A tapped notification has to land on the conversation it promised
// ---------------------------------------------------------------------------

test("#thread= opens that conversation instead of the generic overview", async () => {
  const boot = await bootDashboard({ hash: "#thread=2" });
  assert.equal(boot.el("tab-leads")["aria-selected"], "true", "the leads tab must be the one showing");
  assert.ok(boot.calls.some((c) => c.url.startsWith("/api/connect/messages?thread=2")),
    "the deep-linked conversation must actually be opened and read");
});

test("#tab= from a manifest shortcut selects that tab", async () => {
  const boot = await bootDashboard({ hash: "#tab=calls" });
  assert.equal(boot.el("tab-calls")["aria-selected"], "true");
});

test("a tap on an ALREADY-OPEN Command Center still opens the conversation", async () => {
  // The service worker reuses an open window with client.navigate(). Changing
  // only the fragment is a same-document navigation, so the page never
  // reloads and boot never runs again. Found by following a real
  // notification's own destination in a browser: it landed on the dashboard
  // with the Overview tab showing and no conversation open — in exactly the
  // case the window-reuse path exists to serve.
  const boot = await bootDashboard();
  assert.equal(boot.el("tab-leads")["aria-selected"], "false", "starts on Overview, as a fresh load does");

  await boot.hashTo("#thread=2");

  assert.equal(boot.el("tab-leads")["aria-selected"], "true");
  assert.ok(boot.calls.some((c) => c.url.startsWith("/api/connect/messages?thread=2")),
    "the conversation the alert was about must actually open");
});

// ---------------------------------------------------------------------------
// The worker: run it, push at it, and read the notification it shows
// ---------------------------------------------------------------------------

/** Loads sw.js into a fake ServiceWorkerGlobalScope and returns event drivers. */
function loadWorker({ openWindows = [], missingAsset = "" } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const focused = [];
  const navigated = [];

  const self = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    skipWaiting() {},
    location: { origin: "https://wss-ai.com" },
    registration: {
      showNotification(title, options) { shown.push({ title, options }); return Promise.resolve(); },
    },
    clients: {
      claim() { return Promise.resolve(); },
      matchAll() { return Promise.resolve(openWindows); },
      openWindow(url) { opened.push(url); return Promise.resolve({ url }); },
    },
  };
  for (const client of openWindows) {
    client.focus = () => { focused.push(client.url); return client; };
    if (client.canNavigate) {
      client.navigate = (url) => { navigated.push(url); return Promise.resolve({ url, focus: () => { focused.push(url); } }); };
    }
  }

  const cached = [];
  const cache = {
    add(url) {
      if (url === missingAsset) return Promise.reject(new Error("404"));
      cached.push(url);
      return Promise.resolve();
    },
    put: () => Promise.resolve(),
    match: () => Promise.resolve(null),
  };
  const context = {
    self,
    caches: { open: () => Promise.resolve(cache), keys: () => Promise.resolve([]), match: () => Promise.resolve(null) },
    fetch: () => Promise.resolve({ ok: true, clone: () => ({}) }),
    URL, console, Promise,
  };
  vm.runInNewContext(workerSource, context);

  const fire = async (type, event) => {
    const waits = [];
    const wrapped = { ...event, waitUntil: (p) => waits.push(p) };
    for (const fn of listeners[type] || []) await fn(wrapped);
    await Promise.all(waits);
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
  };

  return { listeners, shown, opened, focused, navigated, cached, fire };
}

test("a real push event produces a real notification", async () => {
  const worker = loadWorker();
  assert.ok((worker.listeners.push || []).length, "no push listener means the message is delivered to nobody");

  await worker.fire("push", {
    data: { json: () => ({ title: "Alpha Lead", body: "Do you cover Saturday callouts?", threadId: 41 }) },
  });

  assert.equal(worker.shown.length, 1);
  assert.equal(worker.shown[0].title, "Alpha Lead");
  assert.equal(worker.shown[0].options.body, "Do you cover Saturday callouts?");
  assert.equal(worker.shown[0].options.icon, "/assets/icon-192.png");
  assert.equal(worker.shown[0].options.data.destination, "/dashboard#thread=41");
});

test("a push with no payload still shows something a customer can act on", async () => {
  const worker = loadWorker();
  await worker.fire("push", { data: null });
  assert.equal(worker.shown.length, 1, "a silent push is a wasted alert");
  assert.match(worker.shown[0].title, /New lead/);
  assert.equal(worker.shown[0].options.data.destination, "/dashboard");
});

test("a forged thread id cannot steer the notification anywhere", async () => {
  const worker = loadWorker();
  await worker.fire("push", { data: { json: () => ({ title: "x", body: "y", threadId: "../../evil?a=b" }) } });
  assert.equal(worker.shown[0].options.data.destination, "/dashboard");
});

test("tapping the notification opens the dashboard on that conversation", async () => {
  const worker = loadWorker();
  let closed = false;
  await worker.fire("notificationclick", {
    notification: { close() { closed = true; }, data: { threadId: "41", destination: "/dashboard#thread=41" } },
  });
  assert.equal(closed, true, "a notification that stays on the lock screen after a tap is a bug");
  assert.deepEqual(worker.opened, ["https://wss-ai.com/dashboard#thread=41"]);
});

test("an already-open Command Center is reused, not made to sign in again", async () => {
  const worker = loadWorker({ openWindows: [{ url: "https://wss-ai.com/dashboard", canNavigate: true }] });
  await worker.fire("notificationclick", {
    notification: { close() {}, data: { threadId: "41" } },
  });
  assert.deepEqual(worker.navigated, ["https://wss-ai.com/dashboard#thread=41"]);
  assert.equal(worker.opened.length, 0, "opening a second window would ask for the PIN again");
});

test("an unrelated open tab is not hijacked", async () => {
  const worker = loadWorker({ openWindows: [{ url: "https://wss-ai.com/products", canNavigate: true }] });
  await worker.fire("notificationclick", { notification: { close() {}, data: { threadId: "41" } } });
  assert.deepEqual(worker.navigated, []);
  assert.deepEqual(worker.opened, ["https://wss-ai.com/dashboard#thread=41"]);
});

test("one missing shell asset cannot brick the worker that carries the alerts", async () => {
  // cache.addAll() is atomic: a single 404 rejects the whole install, the
  // worker never activates, and every push it was going to deliver dies with
  // it. This worker now carries the alerts, so precaching is best-effort.
  const worker = loadWorker({ missingAsset: "/offline.html" });
  await assert.doesNotReject(
    () => worker.fire("install", {}),
    "install must survive a shell asset that 404s",
  );
  assert.ok(worker.cached.includes("/assets/icon-192.png"),
    "the notification icon must still be precached alongside the rest of the shell");
  assert.ok(!worker.cached.includes("/offline.html"));
});
