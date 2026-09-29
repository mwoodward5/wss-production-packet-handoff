"use strict";

// Shared vm harness for the welded WSS Connect v2 page.
//
// The v2 redesign split the single-file app into two inline scripts: the
// backend ADAPTER (installs window.CONNECT_DATA — the API base, token key,
// PIN cipher, push dance, magic-link hash contract) followed by the UI IIFE,
// which talks to business data only through that object. The adapter IS the
// public seam now, so these helpers boot just the adapter in a vm sandbox and
// let tests call window.CONNECT_DATA the same way the UI does — no reaching
// into closure internals the way the v1 owner-proof harness had to.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = path.resolve(__dirname, "../../../connect/index.html");
const API = "https://ghost-agency-backend.vercel.app/api/connect";
const TOKEN_KEY = "wss_connect_token";
// A structurally valid uncompressed P-256 point length; the adapter only
// base64url-decodes it, the fake pushManager never checks curve math.
const VAPID_PUBLIC = Buffer.alloc(65, 7).toString("base64url");

function readPage() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const scripts = [];
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) scripts.push(match[1]);
  assert.ok(scripts.length >= 2, "the welded page keeps the adapter and the UI as separate inline scripts");
  assert.ok(
    scripts[0].includes("WSS CONNECT REAL ADAPTER"),
    "the adapter must be installed BEFORE the UI IIFE — the UI's install guard keeps whichever adapter runs first",
  );
  return { html, scripts, adapterSource: scripts[0], uiSource: scripts[scripts.length - 1], source: scripts.join("\n") };
}

// Brace-matching extractor so structural tests can pin a named adapter
// function without executing the network paths around it.
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not parse ${name}`);
}

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function bootAdapter({
  token = "tenant-token-adapter-proof",
  storage = memoryStorage(token ? { [TOKEN_KEY]: token } : {}),
  hash = "",
  search = "",
  threads = [],
  messages = [],
  routes = {},
  online = true,
  withBadging = true,
  withPushManager = true,
  notificationPermission = "default",
  permissionAnswer = "granted",
  pushSubscription = null,
  openResult = undefined,
  conversationButtons = null,
} = {}) {
  const page = readPage();

  const calls = [];
  const badgeCalls = [];
  const docEvents = [];
  const replaceStates = [];
  const subscribeOptions = [];
  const unsubscribes = [];
  const opened = [];
  const intervals = [];
  const windowListeners = Object.create(null);
  let permissionRequests = 0;
  let currentSubscription = pushSubscription;

  const answer = (body, status = 200) => Promise.resolve(response(status, body));
  const fetchImpl = (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init });
    const pathname = target.startsWith(API) ? target.slice(API.length) : target;
    if (routes[pathname]) return Promise.resolve(routes[pathname](target, init, answer));
    if (pathname === "/threads") return answer({ ok: true, threads, scope: "tenant" });
    if (pathname.startsWith("/messages?thread=")) return answer({ ok: true, messages, scope: "tenant" });
    if (pathname === "/send") {
      const body = JSON.parse(String(init.body || "{}"));
      return answer({
        ok: true,
        message: {
          id: 900,
          thread_id: body.threadId,
          direction: "outbound",
          body: body.body,
          created_at: "2026-08-20T12:00:00.000Z",
          meta: { delivery: { delivered: true } },
        },
        delivery: { channel: "chat", delivered: true },
      });
    }
    if (pathname === "/push-subscribe" && String(init.method || "GET").toUpperCase() === "POST") return answer({ ok: true });
    if (pathname === "/push-subscribe") return answer({ ok: true, configured: true, publicKey: VAPID_PUBLIC, scope: "tenant" });
    if (pathname === "/connectors/status") return answer({ ok: true, siteSlug: "wss-connect", connectors: {} });
    if (pathname === "/site") return answer({ ok: true, businessName: "", clientId: "" });
    return answer({ ok: false, error: "not_found" }, 404);
  };

  const mintedSubscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/harness-device",
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } }; },
    async unsubscribe() { unsubscribes.push("minted"); currentSubscription = null; return true; },
  };
  const registration = {
    pushManager: {
      async getSubscription() { return currentSubscription; },
      async subscribe(options) {
        subscribeOptions.push(options);
        currentSubscription = mintedSubscription;
        return currentSubscription;
      },
    },
  };

  const navigator = {
    onLine: online,
    userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile",
    serviceWorker: {
      async getRegistration() { return registration; },
      ready: Promise.resolve(registration),
      async register() { return registration; },
      addEventListener() {},
    },
  };
  if (withBadging) {
    navigator.setAppBadge = async (count) => { badgeCalls.push(["set", count]); };
    navigator.clearAppBadge = async () => { badgeCalls.push(["clear"]); };
  }

  const conversationListEl = {
    querySelectorAll(selector) {
      if (selector !== ".conversation-main") return [];
      return typeof conversationButtons === "function"
        ? conversationButtons()
        : (conversationButtons || []);
    },
  };

  const sandbox = {
    console,
    Promise,
    URL,
    URLSearchParams,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    Event: class Event { constructor(type) { this.type = String(type); } },
    crypto: crypto.webcrypto,
    localStorage: storage,
    navigator,
    Notification: {
      permission: notificationPermission,
      requestPermission() {
        permissionRequests += 1;
        sandbox.Notification.permission = permissionAnswer;
        return Promise.resolve(permissionAnswer);
      },
    },
    location: { hash, pathname: "/", search, href: `https://connect.wss-labs.com/${search}${hash}` },
    history: { replaceState(...args) { replaceStates.push(args); } },
    document: {
      getElementById(id) { return id === "conversationList" ? conversationListEl : null; },
      dispatchEvent(event) { docEvents.push(event && event.type); return true; },
      addEventListener() {},
    },
    fetch: fetchImpl,
    setTimeout(fn) { setImmediate(fn); return 1; },
    clearTimeout() {},
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {},
    atob(value) { return Buffer.from(String(value), "base64").toString("binary"); },
    btoa(value) { return Buffer.from(String(value), "binary").toString("base64"); },
    open(...args) { opened.push(args); return openResult; },
    addEventListener(type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn); },
    removeEventListener() {},
  };
  if (withPushManager) sandbox.PushManager = class PushManager {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  new vm.Script(page.adapterSource, { filename: "wss-connect-adapter.js" }).runInNewContext(sandbox);
  await settle();

  return {
    page,
    sandbox,
    adapter: sandbox.window.CONNECT_DATA,
    storage,
    calls,
    badgeCalls,
    docEvents,
    replaceStates,
    subscribeOptions,
    unsubscribes,
    opened,
    intervals,
    windowListeners,
    permissionRequests: () => permissionRequests,
    async emit(type, event = {}) {
      for (const fn of windowListeners[type] || []) await fn(event);
      await settle();
    },
    settle,
  };
}

module.exports = {
  API,
  TOKEN_KEY,
  VAPID_PUBLIC,
  htmlPath,
  readPage,
  functionSource,
  memoryStorage,
  response,
  settle,
  bootAdapter,
};
