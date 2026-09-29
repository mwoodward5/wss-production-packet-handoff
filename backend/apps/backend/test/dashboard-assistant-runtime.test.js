"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const DASHBOARD = path.resolve(__dirname, "../../labs-site/dashboard/index.html");
const html = fs.readFileSync(DASHBOARD, "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

async function boot({ editReads = [{ ok: true, edits: [] }], Vapi = null } = {}) {
  const elements = new Map();
  const timers = new Map();
  const calls = [];
  let timerId = 0;
  let editRead = 0;

  const element = (id) => {
    if (!elements.has(id)) {
      const attributes = Object.create(null);
      const classes = new Set();
      const node = {
        id,
        attributes,
        className: "",
        disabled: false,
        hidden: id === "edittheater" || id === "voicepanel",
        href: "",
        innerHTML: "",
        listeners: Object.create(null),
        offsetWidth: 100,
        scrollHeight: 500,
        scrollTop: 0,
        src: "",
        style: { setProperty(name, value) { this[name] = String(value); } },
        textContent: "",
        value: "",
        addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
        setAttribute(name, value) { attributes[name] = String(value); },
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
        removeAttribute(name) { delete attributes[name]; },
        focus() {},
        click() {},
        insertBefore(child) { this.firstElementChild = child; },
        querySelector(selector) { return element(`${id}::${selector}`); },
      };
      node.classList = {
        add(name) { classes.add(name); node.className = [...classes].join(" "); },
        remove(name) { classes.delete(name); node.className = [...classes].join(" "); },
        contains(name) { return classes.has(name); },
        toggle(name, on) { if (on) this.add(name); else this.remove(name); },
      };
      elements.set(id, node);
    }
    return elements.get(id);
  };

  const answer = (body, status = 200) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
  const fakeSetTimeout = (fn, delay) => {
    const id = ++timerId;
    timers.set(id, { fn, delay });
    return id;
  };
  const fakeClearTimeout = (id) => timers.delete(id);
  const windowListeners = Object.create(null);
  const sandbox = {
    Promise,
    URL,
    Date,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    fetch(url, init = {}) {
      calls.push({ url: String(url), init });
      const route = String(url).split("?")[0];
      if (route === "/api/connect/threads") return answer({ ok: true, threads: [], summary: { unrepliedCount: 0 } });
      if (route === "/api/connect/site") return answer({
        ok: true,
        businessName: "Proof Company",
        clientId: "WSS-PROOF",
        site: { available: true, url: "https://proof-company.wss-ai.com/", host: "proof-company.wss-ai.com" },
        report: { available: false, reason: "no_report_on_file" },
      });
      if (route === "/api/connect/visibility") return answer({ ok: true, configured: true, points: [] });
      if (route === "/api/connect/edits") {
        const response = editReads[Math.min(editRead, editReads.length - 1)];
        editRead += 1;
        return answer(response);
      }
      if (route === "/api/connect/assistant") return answer({ ok: true, settings: {}, activity: [] });
      if (route === "/api/connect/voice-config") return answer({
        publicKey: "public-test-key",
        assistantId: "assistant-test-id",
        metadata: { site_slug: "proof-company", client_id: "WSS-PROOF", business_name: "Proof Company" },
      });
      return answer({ ok: true });
    },
    document: {
      documentElement: element("html"),
      getElementById: element,
      querySelector() { return null; },
      addEventListener() {},
    },
    localStorage: {
      getItem(key) { return key === "wss_connect_token" ? "scoped-test-token" : null; },
      setItem() {},
      removeItem() {},
    },
    location: { hash: "", pathname: "/dashboard", reload() {} },
    history: { replaceState() {} },
    navigator: { language: "en-US" },
    crypto: { subtle: { digest: () => Promise.reject(new Error("not used")) } },
  };
  sandbox.window = {
    __wssVapiCtor: Vapi ? Promise.resolve(Vapi) : null,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(type, handler) { (windowListeners[type] = windowListeners[type] || []).push(handler); },
  };

  vm.runInNewContext(script, sandbox);
  const settle = async () => { for (let i = 0; i < 50; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  await settle();

  return {
    calls,
    el: element,
    async fire(id, type = "click", event = {}) {
      for (const handler of element(id).listeners[type] || []) await handler(event);
      await settle();
    },
    async runTimer(delay) {
      const found = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(found, `missing ${delay}ms timer`);
      timers.delete(found[0]);
      await found[1].fn();
      await settle();
    },
  };
}

test("the visible theater repeats the recorded meter word for word", async () => {
  const running = {
    jobId: "job-real-1",
    message: "Update the hours.",
    status: "running",
    open: true,
    meter: { stage: "reading", stageWords: "Reading your site", plainWords: "I am checking the hours already on your live site.", percent: 18 },
  };
  const page = await boot({ editReads: [{ ok: true, edits: [running] }] });

  assert.equal(page.el("edittheater").hidden, false);
  assert.equal(page.el("theaterstage").textContent, running.meter.stageWords);
  assert.equal(page.el("theaterwords").textContent, running.meter.plainWords);
  assert.equal(page.el("theaterpercent").textContent, "18%");
  assert.equal(page.el("theaterbar").attributes["aria-valuenow"], "18");
});

test("a queued record without plainWords never invents a theater stage", async () => {
  const page = await boot({
    editReads: [{ ok: true, edits: [{ jobId: "job-no-meter", message: "Change it.", status: "queued", open: true, meter: { percent: 4 } }] }],
  });

  assert.equal(page.el("edittheater").hidden, true);
  assert.equal(page.el("theaterstage").textContent, "");
  assert.equal(page.el("theaterwords").textContent, "");
});

test("only the tracked job finishing cache-busts the live preview", async () => {
  const running = {
    jobId: "job-real-2",
    message: "Update the hours.",
    status: "running",
    open: true,
    meter: { stage: "editing", stageWords: "Editing", plainWords: "I am updating the verified hours.", percent: 55 },
  };
  const done = {
    ...running,
    status: "done",
    open: false,
    meter: { stage: "published", stageWords: "Published", plainWords: "The verified hours are live.", percent: 100 },
  };
  const page = await boot({ editReads: [{ ok: true, edits: [running] }, { ok: true, edits: [done] }] });
  const before = page.el("sitepreview").src;
  await page.runTimer(4000);

  assert.notEqual(page.el("sitepreview").src, before);
  assert.match(page.el("sitepreview").src, /^https:\/\/proof-company\.wss-ai\.com\/\?t=\d+$/);
  assert.equal(page.el("theaterstage").textContent, "Published");
  assert.equal(page.el("theaterwords").textContent, "The verified hours are live.");
});

test("the Riley button uses only public runtime config and starts in-browser Vapi", async () => {
  const observed = { constructor: null, start: null };
  class FakeVapi {
    constructor(...args) { observed.constructor = args; this.handlers = {}; }
    on(name, handler) { this.handlers[name] = handler; }
    start(...args) {
      observed.start = args;
      this.handlers["call-start"]();
      return Promise.resolve({ id: "call-test" });
    }
    stop() { return Promise.resolve(); }
  }
  const page = await boot({ Vapi: FakeVapi });
  await page.fire("voicecall");

  assert.ok(page.calls.some((call) => call.url === "/api/connect/voice-config"));
  assert.equal(observed.constructor[0], "public-test-key");
  assert.equal(observed.start[0], "assistant-test-id");
  assert.deepEqual(JSON.parse(JSON.stringify(observed.start[1])), {
    metadata: { site_slug: "proof-company", client_id: "WSS-PROOF", business_name: "Proof Company" },
  });
  assert.equal(page.el("voicestatus").textContent, "Riley is listening…");
});
