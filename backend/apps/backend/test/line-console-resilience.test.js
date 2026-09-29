"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const page = require("../lib/line-console-page");
const script = /<script>([\s\S]*?)<\/script>/.exec(page)[1];

function batch(status, queued) {
  return {
    batchId: "batch-safe-1",
    lane: "sandbox",
    status,
    requested: 3,
    counts: { total: 3, queued, failed: 0, sent: 3 - queued, working: 0 },
    rows: [],
  };
}

async function runConsole({ initialBatch = null, onPost } = {}) {
  const elements = new Map();
  let document;

  function classList() {
    const values = new Set();
    return {
      add(value) { values.add(value); },
      remove(value) { values.delete(value); },
      contains(value) { return values.has(value); },
      toggle(value, forced) {
        const on = typeof forced === "boolean" ? forced : !values.has(value);
        if (on) values.add(value); else values.delete(value);
        return on;
      },
    };
  }

  function element(id, attrs = {}) {
    if (!elements.has(id)) {
      const attributes = { ...attrs };
      const listeners = new Map();
      elements.set(id, {
        id,
        value: "",
        disabled: false,
        textContent: "",
        innerHTML: "",
        style: {},
        className: "",
        classList: classList(),
        onclick: null,
        setAttribute(name, value) { attributes[name] = String(value); },
        getAttribute(name) { return attributes[name] || null; },
        addEventListener(name, handler) {
          if (!listeners.has(name)) listeners.set(name, []);
          listeners.get(name).push(handler);
        },
        dispatchEvent(event) {
          for (const handler of listeners.get(event.type) || []) handler.call(this, event);
          return true;
        },
        querySelectorAll() { return []; },
        focus() { document.activeElement = this; },
      });
    }
    return elements.get(id);
  }

  const launches = [
    element("mine50", { "data-launch": "50" }),
    element("mine100", { "data-launch": "100" }),
    element("mine500", { "data-launch": "500" }),
  ];
  element("lane").value = "sandbox";

  const body = element("body");
  document = {
    body,
    activeElement: body,
    hidden: false,
    contains() { return true; },
    addEventListener() {},
    getElementById(id) { return element(id); },
    querySelectorAll(selector) { return selector === "[data-launch]" ? launches : []; },
  };

  const calls = [];
  const answer = (payload, status = 200) => Promise.resolve({
    status,
    json: () => Promise.resolve(payload),
  });
  const readiness = {
    ready: true,
    deliveryPause: { active: false },
    reviewHold: { active: false },
    liveSendsEnabled: false,
    blockers: [],
  };
  const pause = { ok: true, deliveryPause: { active: false, known: true, reason: "", at: "" } };

  const fetch = (url, options = {}) => {
    const method = options.method || "GET";
    const request = {
      url: String(url),
      method,
      body: options.body ? JSON.parse(options.body) : null,
    };
    calls.push(request);
    if (request.url.split("?")[0] === "/api/admin/outreach-pause") return answer(pause);
    if (request.url.split("?")[0] !== "/api/admin/line") return answer({ ok: false }, 404);
    if (method === "POST") {
      let outcome;
      try { outcome = onPost ? onPost(request.body, calls) : { ok: false, error: "unexpected_post" }; }
      catch (error) { return Promise.reject(error); }
      return Promise.resolve(outcome).then((result) => {
        if (result && result.networkError) return Promise.reject(result.networkError);
        if (result && Object.hasOwn(result, "payload")) return answer(result.payload, result.status || 200);
        return answer(result);
      });
    }
    return answer({ ok: true, batch: initialBatch, batches: initialBatch ? [initialBatch] : [], readiness, spend: {} });
  };

  const storage = new Map([["wsl_admin_token", "test-token"]]);
  let randomByte = 0;
  const browserCrypto = {
    getRandomValues(bytes) {
      randomByte = (randomByte + 1) & 255;
      bytes.fill(randomByte);
      return bytes;
    },
  };
  const sandbox = {
    console,
    document,
    window: { confirm: () => true, crypto: browserCrypto },
    crypto: browserCrypto,
    fetch,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    location: { hash: "", pathname: "/line" },
    history: { replaceState() {} },
    setTimeout(fn) { queueMicrotask(fn); return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
  };

  vm.runInNewContext(script, sandbox, { filename: "line-console-inline.js" });
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return {
    calls,
    el: (id) => element(id),
    flush: async () => {
      for (let i = 0; i < 60; i += 1) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("a queued launch never asks the browser to continue with another start", async () => {
  const queued = batch("queued", 0);
  const consoleRun = await runConsole({
    onPost(body) {
      assert.equal(body.action, "start");
      return { ok: true, queued: true, batchId: queued.batchId, batch: queued };
    },
  });
  consoleRun.el("target").value = "roofing in Austin, TX";

  consoleRun.el("mine50").onclick();
  await consoleRun.flush();
  const starts = consoleRun.calls.filter((call) => call.body && call.body.action === "start");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].body.lane, "sandbox", "the fresh launch keeps the selected lane");
  assert.match(consoleRun.el("launchOut").textContent, /server-owned continuation/);
});

test("a lost or retryable start response reuses one PII-free key for the exact request", async () => {
  const queued = batch("queued", 0);
  let attempt = 0;
  const consoleRun = await runConsole({
    onPost(body) {
      attempt += 1;
      if (attempt === 1) return { networkError: new TypeError("connection reset") };
      if (attempt === 2) return {
        status: 503,
        payload: { ok: false, retryable: true, error: "line_queue_unavailable" },
      };
      return { ok: true, queued: true, batchId: queued.batchId, batch: queued };
    },
  });
  consoleRun.el("target").value = "roofing in Austin, TX";

  consoleRun.el("mine50").onclick();
  await consoleRun.flush();
  consoleRun.el("mine50").onclick();
  await consoleRun.flush();
  consoleRun.el("mine50").onclick();
  await consoleRun.flush();

  const starts = consoleRun.calls.filter((call) => call.body && call.body.action === "start");
  assert.equal(starts.length, 3);
  assert.match(starts[0].body.idempotencyKey, /^launch-[a-f0-9]{32}$/);
  assert.equal(starts[1].body.idempotencyKey, starts[0].body.idempotencyKey);
  assert.equal(starts[2].body.idempotencyKey, starts[0].body.idempotencyKey);
  assert.equal(starts[0].body.idempotencyKey.includes(starts[0].body.target), false);
});

test("changing a launch input clears an uncertain key", async () => {
  const consoleRun = await runConsole({
    onPost() { return { networkError: new TypeError("connection reset") }; },
  });

  consoleRun.el("mine50").onclick();
  await consoleRun.flush();
  consoleRun.el("target").value = "roofing in Austin, TX";
  consoleRun.el("target").dispatchEvent({ type: "input" });
  consoleRun.el("mine50").onclick();
  await consoleRun.flush();

  const starts = consoleRun.calls.filter((call) => call.body && call.body.action === "start");
  assert.equal(starts.length, 2);
  assert.notEqual(starts[1].body.idempotencyKey, starts[0].body.idempotencyKey);
  assert.equal(starts[1].body.target, "roofing in Austin, TX");
});

test("the launch pending guard blocks a same-tick double click", async () => {
  const queued = batch("queued", 0);
  let resolveStart;
  const pending = new Promise((resolve) => { resolveStart = resolve; });
  const consoleRun = await runConsole({ onPost() { return pending; } });

  consoleRun.el("mine50").onclick();
  consoleRun.el("mine50").onclick();
  const starts = consoleRun.calls.filter((call) => call.body && call.body.action === "start");
  assert.equal(starts.length, 1);

  resolveStart({ ok: true, queued: true, batchId: queued.batchId, batch: queued });
  await consoleRun.flush();
});

test("an approved batch resumes without approval and stops on flat remaining", async () => {
  const responses = [
    { ok: true, attempted: 2, sent: 2, failures: [], remaining: 1, batch: batch("approved", 1), spend: {} },
    { ok: true, attempted: 1, sent: 0, failures: [{ prospectId: "p-3", reason: "provider_refused" }], remaining: 1, batch: batch("approved", 1), spend: {} },
  ];
  const consoleRun = await runConsole({
    initialBatch: batch("approved", 3),
    onPost(body) {
      assert.equal(body.action, "send", "an approved batch must not be approved again");
      return responses.shift();
    },
  });

  consoleRun.el("sendBtn").onclick();
  await consoleRun.flush();

  const actions = consoleRun.calls.filter((call) => call.body).map((call) => call.body.action);
  assert.deepEqual(actions, ["send", "send"]);
  assert.match(consoleRun.el("sendOut").textContent, /Attempted: 3/);
  assert.match(consoleRun.el("sendOut").textContent, /Sent: 2/);
  assert.match(consoleRun.el("sendOut").textContent, /Failed: 1/);
  assert.match(consoleRun.el("sendOut").textContent, /Remaining: 1/);
  assert.match(consoleRun.el("sendOut").textContent, /remaining did not fall/);
  assert.equal(consoleRun.el("sendBtn").textContent, "Retry remaining 1");
  assert.equal(consoleRun.el("sendBtn").disabled, false);
});
