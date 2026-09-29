"use strict";

// Console arcade hero — integration guard for the WSS Ghost Arcade overview.
//
// Two layers:
//   1. PAGE PINS — lib/console-page.js wires the hero additively: host div
//      above the glance deck, module inlined (no second request), demo route
//      branch that fetches nothing, and the replay-safe data hooks.
//   2. BEHAVIOR — the REAL delivered module string (lib/console-arcade-layer)
//      is evaluated in a minimal DOM shim and must prove the owner contract:
//      demo banner + zero fetches for a full loop, idle live mode animates
//      nothing real, blocked events park at the failing station with a reason,
//      duplicate event ids never replay, unknown renders Unknown (never 0).

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const page = require("../lib/console-page");
const arcadeSource = require("../lib/console-arcade-layer");

// ---------------------------------------------------------------------------
// 1. PAGE PINS — additive wiring inside /console
// ---------------------------------------------------------------------------

test("arcade hero host sits in the Command Center panel, above the glance deck", () => {
  const panel = page.indexOf('id="tabPanelCommand"');
  const hero = page.indexOf('id="wssArcadeHero"');
  const glance = page.indexOf('id="glanceDeck"');
  assert.ok(panel >= 0, "Command Center panel missing");
  assert.ok(hero > panel, "hero host must be inside the Command Center panel");
  assert.ok(glance > hero, "hero must sit above the glance deck (the approved deck stays below)");
});

test("the delivered arcade module is inlined before the controller (zero new requests)", () => {
  assert.ok(page.includes(arcadeSource), "module source must be inlined verbatim into the page string");
  const moduleAt = page.indexOf(arcadeSource);
  // The controller's unique opening: its IIFE starts with the token key setup.
  const controller = page.indexOf("var KEY=\"wsl_admin_token\"");
  assert.ok(controller > moduleAt, "module must load before the controller boots");
  assert.match(arcadeSource, /window\.WSSArcade/);
  assert.match(page, /wss-arcade-layer-style/);
});

test("hero wiring honors the hard-truth law (watching surface, motion never implies work)", () => {
  assert.match(page, /WATCHING SURFACE/);
  assert.match(page, /Ambient motion never implies work/);
  assert.match(page, /prime, don't play/i);
});

test("live data hooks feed the hero from the existing polls", () => {
  const loadHook = page.indexOf("arcadeConsoleData(snapshot);");
  const loadFn = page.indexOf("function load(){");
  assert.ok(loadFn >= 0 && loadHook > loadFn, "console-data snapshot must feed the hero");
  const lineHook = page.indexOf("arcadeLineData(list);");
  const lineFn = page.indexOf("function loadBatches(){");
  assert.ok(lineFn >= 0 && lineHook > lineFn, "/api/admin/line batches must feed the theater");
});

test("the demo branch never fetches, never polls, and skips the token gate", () => {
  const bootAt = page.indexOf("mountArcade();\n  if(ARCADE_DEMO){");
  assert.ok(bootAt >= 0, "boot must mount the hero once, then branch demo vs live");
  const start = page.indexOf("if(ARCADE_DEMO){", bootAt);
  const end = page.indexOf("}else{", start);
  assert.ok(start >= 0 && end > start, "demo/live boot branch missing");
  const demoBranch = page.slice(start, end);
  assert.match(demoBranch, /DEMO — NO LIVE ACTIONS/);
  assert.match(demoBranch, /data-demo/);
  assert.doesNotMatch(demoBranch, /\bapi\(/, "demo must not call api()");
  assert.doesNotMatch(demoBranch, /fetch\(/, "demo must not fetch");
  assert.doesNotMatch(demoBranch, /armPoll\(/, "demo must not start the 30s poll");
  assert.doesNotMatch(demoBranch, /loadBatches\(/, "demo must not start the line poll");
  assert.doesNotMatch(demoBranch, /showGate\(/, "demo must not show the token gate");
  // Production mode must never load synthetic data: live branch never passes mode:'demo'.
  const mountFn = page.slice(page.indexOf("function mountArcade(){"), page.indexOf("function armPoll(){"));
  assert.match(mountFn, /mode:ARCADE_DEMO\?"demo":"live"/);
  assert.doesNotMatch(mountFn, /mode:"demo"/);
});

test("arcade feed cadences follow the poll plan and stay defensive", () => {
  assert.match(page, /api\("\/api\/admin\/vapi-calls"\)/);
  assert.match(page, /setInterval\(arcadePollVapi,7000\)/);
  assert.match(page, /api\("\/api\/admin\/gallery-data"\)/);
  assert.match(page, /setInterval\(arcadePollGallery,60000\)/);
  assert.match(page, /api\("\/api\/admin\/revenue-summary"\)/);
  // Every arcade poll body skips while the tab is hidden (skip, never queue).
  for (const fn of ["arcadePollVapi", "arcadePollGallery", "arcadePollRevenue"]) {
    assert.match(page, new RegExp(`function ${fn}\\(\\)\\{\\s*if\\([^\\n]*document\\.hidden`), `${fn} stays visible-only`);
  }
  // revenue-summary may 404 (route not deployed): MRR stays Unknown and the poll stops.
  assert.match(page, /if\(error&&error\.status===404\)arcadeRevenueDone=true/);
  assert.match(page, /var arcadeRevenueMrr=null/);
  // revenue-summary mrr is CENTS (activeClients x planAmountCents): converted to dollars.
  assert.match(page, /if\(d\.mrr!=null\)raw=Number\(d\.mrr\)\/100/);
  // VAPI disconnected truth: ok:false renders the reason, never a ring.
  assert.match(page, /if\(!d\|\|d\.ok!==true\)\{\s*\/\/ Disconnected truth/);
  assert.match(page, /Voice not connected: /);
});

test("counters are absolute with a bounded seen-set; events key on durable identities", () => {
  assert.match(page, /var arcadeAbs=\{\}/);
  assert.match(page, /if\(prev===undefined\|\|n<=prev\)return false/);
  assert.match(page, /if\(arcadeSeenQ\.length>600\)delete arcadeSeen\[arcadeSeenQ\.shift\(\)\]/);
  assert.match(page, /"arc:cnt:"\+key\+":"\+n/, "counter events key on the observed absolute value");
  assert.match(page, /"arc:row:"\+key\+":dead"/, "row events key on batch|row:stage");
  assert.match(page, /"arc:row:"\+key\+":sent"/);
  assert.match(page, /"arc:call:"\+id/, "call rings key on the VAPI call id");
  // Row-ladder sources are exclusive so one real email never draws twice.
  assert.match(page, /queued\/sent\/built come/);
});

test("page adds no animation of its own to the hero (module owns motion; reduced-motion never doubled)", () => {
  assert.match(arcadeSource, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(arcadeSource, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  const css = page.slice(page.indexOf("#wssArcadeHero{margin"), page.indexOf("</style>", page.indexOf("#wssArcadeHero{margin")));
  assert.ok(css.length > 0 && css.length < 600, "page CSS for the hero stays minimal");
  assert.doesNotMatch(css, /@keyframes|animation:|transition:/);
});

// ---------------------------------------------------------------------------
// 2. BEHAVIOR — the delivered module executed in a minimal DOM shim
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set(["area", "br", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function parseHTML(html, createElement) {
  const root = createElement("div");
  const stack = [root];
  let i = 0;
  const appendText = (parent, text) => {
    if (!text) return;
    const node = { nodeType: 3, text, parentNode: parent };
    parent._children.push(node);
  };
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { appendText(stack[stack.length - 1], html.slice(i)); break; }
    if (lt > i) appendText(stack[stack.length - 1], html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt);
    if (gt < 0) break;
    const raw = html.slice(lt + 1, gt);
    if (raw.startsWith("/")) { stack.pop(); i = gt + 1; continue; }
    const selfClose = /\/\s*$/.test(raw);
    const body = selfClose ? raw.replace(/\/\s*$/, "") : raw;
    const tagMatch = body.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
    const el = createElement(tagMatch ? tagMatch[0] : "div");
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'))?/g;
    attrRe.lastIndex = tagMatch ? tagMatch[0].length : 0;
    let am;
    while ((am = attrRe.exec(body))) {
      if (am[1] === "/") continue;
      // am[3] = double-quoted inner, am[4] = single-quoted inner
      const value = am[3] != null ? am[3] : (am[4] != null ? am[4] : "");
      el.setAttribute(am[1], value);
    }
    const parent = stack[stack.length - 1];
    el.parentNode = parent;
    parent._children.push(el);
    if (!selfClose && !VOID_TAGS.has(el.tagName.toLowerCase())) stack.push(el);
    i = gt + 1;
  }
  return root._children;
}

function makeSandbox() {
  const fetchCalls = [];
  const rafQ = [];
  const clock = { now: 1000 };
  const listeners = { doc: {} };

  function matchesCompound(el, part) {
    if (!el || el.nodeType !== 1) return false;
    let rest = part;
    const tag = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
    if (tag) {
      if (el.tagName !== tag[0].toUpperCase()) return false;
      rest = rest.slice(tag[0].length);
    }
    while (rest.length) {
      if (rest[0] === ".") {
        const m = rest.slice(1).match(/^[a-zA-Z0-9_-]+/);
        const cls = m && m[0];
        if (!cls || !el.classList.contains(cls)) return false;
        rest = rest.slice(1 + cls.length);
      } else if (rest[0] === "#") {
        const m = rest.slice(1).match(/^[a-zA-Z0-9_-]+/);
        const id = m && m[0];
        if (!id || el.getAttribute("id") !== id) return false;
        rest = rest.slice(1 + id.length);
      } else if (rest[0] === "[") {
        const end = rest.indexOf("]");
        if (end < 0) return false;
        const inner = rest.slice(1, end);
        const eq = inner.indexOf("=");
        if (eq < 0) {
          if (el.getAttribute(inner) == null) return false;
        } else {
          const name = inner.slice(0, eq);
          const value = inner.slice(eq + 1).replace(/^["']|["']$/g, "");
          if (el.getAttribute(name) !== value) return false;
        }
        rest = rest.slice(end + 1);
      } else {
        return false;
      }
    }
    return true;
  }
  function matchesPath(el, parts) {
    if (!el || el.nodeType !== 1) return false;
    if (!matchesCompound(el, parts[parts.length - 1])) return false;
    let anc = el.parentNode;
    let idx = parts.length - 2;
    while (idx >= 0) {
      while (anc && !(anc.nodeType === 1 && matchesCompound(anc, parts[idx]))) anc = anc.parentNode;
      if (!anc) return false;
      idx -= 1;
      anc = anc.parentNode;
    }
    return true;
  }
  function queryAll(root, selector) {
    const out = [];
    const paths = String(selector).split(",").map((s) => s.trim()).filter(Boolean).map((p) => p.split(/\s+/));
    (function walk(node) {
      node.children.forEach((child) => {
        if (paths.some((parts) => matchesPath(child, parts))) out.push(child);
        walk(child);
      });
    })(root);
    return out;
  }

  class Elem {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this._children = [];
      this._attrs = {};
      this.parentNode = null;
      this._class = "";
      this.style = { setProperty() {}, removeProperty() {} };
      this.tabIndex = 0;
      this.title = "";
      const self = this;
      this.dataset = new Proxy({}, {
        get(_t, key) { return self.getAttribute("data-" + String(key).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())); },
        set(_t, key, value) {
          self.setAttribute("data-" + String(key).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), String(value));
          return true;
        },
      });
      this._listeners = {};
    }
    get id() { return this.getAttribute("id") || ""; }
    set id(v) { this.setAttribute("id", v); }
    get className() { return this._class; }
    set className(v) { this._class = String(v); }
    get classList() {
      const self = this;
      return {
        add(...names) { names.forEach((n) => { const set = new Set(self._class.split(/\s+/).filter(Boolean)); set.add(n); self._class = [...set].join(" "); }); },
        remove(...names) { const set = new Set(self._class.split(/\s+/).filter(Boolean)); names.forEach((n) => set.delete(n)); self._class = [...set].join(" "); },
        toggle(name, force) {
          const set = new Set(self._class.split(/\s+/).filter(Boolean));
          const on = force === undefined ? !set.has(name) : Boolean(force);
          if (on) set.add(name); else set.delete(name);
          self._class = [...set].join(" ");
          return on;
        },
        contains(name) { return self._class.split(/\s+/).filter(Boolean).indexOf(name) >= 0; },
      };
    }
    get children() { return this._children.filter((n) => n.nodeType === 1); }
    get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
    get isConnected() {
      let n = this;
      while (n.parentNode) n = n.parentNode;
      return n === shimDoc;
    }
    get textContent() {
      return this._children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join("");
    }
    set textContent(v) {
      this._children = [{ nodeType: 3, text: String(v == null ? "" : v), parentNode: this }];
    }
    get innerHTML() { return this.textContent; }
    set innerHTML(v) {
      this._children = parseHTML(String(v == null ? "" : v), (tag) => new Elem(tag));
      // parseHTML builds under a temp root: re-parent top-level nodes here.
      this._children.forEach((n) => { n.parentNode = this; });
    }
    setAttribute(name, value) {
      this._attrs[String(name)] = String(value);
      if (String(name) === "class") this._class = String(value);
      if (String(name) === "style") {
        String(value).split(";").forEach((decl) => {
          const i = decl.indexOf(":");
          if (i > 0) this.style[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
        });
      }
    }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, String(name)) ? this._attrs[String(name)] : null; }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this._children.push(child);
      return child;
    }
    prepend(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this._children.unshift(child);
      return child;
    }
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const i = this._children.indexOf(ref);
      child.parentNode = this;
      if (i < 0) this._children.push(child); else this._children.splice(i, 0, child);
      return child;
    }
    removeChild(child) {
      const i = this._children.indexOf(child);
      if (i >= 0) { this._children.splice(i, 1); child.parentNode = null; }
      return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    removeEventListener(type, fn) {
      const list = this._listeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
    dispatch(type, event) { (this._listeners[type] || []).slice().forEach((fn) => fn(event)); }
    querySelector(sel) { return queryAll(this, sel)[0] || null; }
    querySelectorAll(sel) { return queryAll(this, sel); }
    closest(sel) {
      const part = String(sel).trim();
      let n = this;
      while (n && n.nodeType === 1) {
        if (matchesCompound(n, part)) return n;
        n = n.parentNode;
      }
      return null;
    }
    animate() { return { onfinish: null }; }
    getAnimations() { return []; }
  }

  const shimDoc = new Elem("#document");
  shimDoc.nodeType = 9;
  const head = new Elem("head");
  const body = new Elem("body");
  head.parentNode = shimDoc;
  body.parentNode = shimDoc;

  const doc = {
    hidden: false,
    head,
    body,
    createElement: (tag) => new Elem(tag),
    createElementNS: (_ns, tag) => new Elem(tag),
    getElementById(id) { return queryAll(body, "#" + id)[0] || head.querySelector("#" + id) || null; },
    addEventListener(type, fn) { (listeners.doc[type] = listeners.doc[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const list = listeners.doc[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
  };
  head.querySelector = Elem.prototype.querySelector;

  const windowObj = {
    document: doc,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame(cb) { rafQ.push(cb); return rafQ.length; },
    cancelAnimationFrame() {},
    matchMedia(query) {
      return { matches: false, media: query, addEventListener() {}, removeEventListener() {} };
    },
    fetch(...args) { fetchCalls.push(args); return Promise.reject(new Error("network disabled")); },
  };

  const sandbox = {
    window: windowObj,
    document: doc,
    performance: { now: () => clock.now },
    requestAnimationFrame: windowObj.requestAnimationFrame,
    cancelAnimationFrame: windowObj.cancelAnimationFrame,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Element: Elem,
    console: { log() {}, warn() {}, error() {}, debug() {} },
    fetch: windowObj.fetch,
  };
  vm.createContext(sandbox);
  vm.runInContext(arcadeSource, sandbox, { filename: "wss-arcade-layer.js" });

  const container = doc.createElement("div");
  doc.body.appendChild(container);

  return {
    sandbox, doc, fetchCalls, rafQ, clock, container,
    WSSArcade: sandbox.window.WSSArcade,
    driveFrames(count, step) {
      for (let k = 0; k < count; k += 1) {
        clock.now += step || 50;
        rafQ.splice(0).forEach((cb) => cb(clock.now));
      }
    },
  };
}

function mount(mode) {
  const ctx = makeSandbox();
  assert.ok(ctx.WSSArcade && typeof ctx.WSSArcade.mount === "function", "module must expose window.WSSArcade.mount");
  const ctl = ctx.WSSArcade.mount(ctx.container, { mode, reducedMotion: false, sound: false });
  const root = ctx.container.children[0];
  return { ctx, ctl, root, fetchCalls: ctx.fetchCalls };
}

test("delivered module stays a network-free watching surface", () => {
  assert.doesNotMatch(arcadeSource, /fetch\s*\(/, "module must not fetch");
  assert.doesNotMatch(arcadeSource, /XMLHttpRequest/, "module must not use XHR");
  assert.doesNotMatch(arcadeSource, /WebSocket|EventSource|sendBeacon/, "module must not open channels");
  assert.match(arcadeSource, /watching surface only/i);
});

test("hero renders six stations and the seven-stage theater strip", () => {
  const { ctx, ctl, root } = mount("live");
  try {
    const stations = root.querySelectorAll(".station-card");
    assert.equal(stations.length, 6);
    const keys = stations.map((s) => s.getAttribute("data-station"));
    assert.deepEqual(keys, ["mine", "qualify", "build", "outreach", "engage", "convert"]);
    const stages = root.querySelectorAll(".stages .stage");
    assert.deepEqual(stages.map((s) => s.textContent), ["START", "MINE", "QUALIFY", "BUILD", "QUEUE", "APPROVE", "SEND"]);
    assert.ok(root.querySelector(".vapi"), "VAPI provider chip present");
    ctx.driveFrames(10);
  } finally { ctl.destroy(); }
});

test("demo mode: banner visible, controls present, zero fetches across a full loop", async () => {
  const { ctx, ctl, root, fetchCalls } = mount("demo");
  try {
    assert.ok(root.classList.contains("is-demo"));
    const banner = root.querySelector(".demo-banner");
    assert.match(banner.textContent, /DEMO — NO LIVE ACTIONS/);
    const demoControls = root.querySelector(".demo-controls");
    assert.notEqual(demoControls.style.display, "none");
    // Drive past one full 76s loop plus the blocked example at ~69s.
    ctx.driveFrames(640, 100); // 64s
    const burst = root.querySelector(".revenue-burst");
    assert.ok(burst, "+$199 burst appeared by the paid beat");
    assert.match(banner.textContent, /DEMO/);
    ctx.driveFrames(70, 100); // 71s: blocked example fired, chip still alive
    const reason = root.querySelector(".reason-chip");
    assert.ok(reason, "demo blocked example shows its reason chip");
    assert.match(reason.textContent, /owner verification required/i);
    ctx.driveFrames(120, 100); // 83s: loop wrapped
    assert.equal(fetchCalls.length, 0, "demo must make zero fetch calls");
    assert.equal(typeof ctx.sandbox.XMLHttpRequest, "undefined");
    // Controls: pause freezes the synthetic clock; resume and speed work.
    const elapsedBefore = ctl.demoElapsed;
    ctl.pauseDemo();
    assert.match(root.querySelector(".demo-pause").textContent, /Resume/);
    ctx.driveFrames(10, 100);
    assert.equal(ctl.demoElapsed, elapsedBefore, "paused demo must not advance");
    ctl.resumeDemo();
    ctx.driveFrames(10, 100);
    assert.ok(ctl.demoElapsed > elapsedBefore, "resumed demo advances");
    ctl.setDemoSpeed(2);
    assert.match(root.querySelector(".demo-speed").textContent, /2x/);
    await new Promise((r) => setTimeout(r, 30));
  } finally { ctl.destroy(); }
});

test("live mode with zero events animates nothing real (ambient only, Unknown everywhere)", () => {
  const { ctx, ctl, root, fetchCalls } = mount("live");
  try {
    assert.ok(!root.classList.contains("is-demo"));
    assert.equal(root.querySelector(".demo-banner").textContent.trim(), "DEMO — NO LIVE ACTIONS");
    assert.equal(root.querySelector(".demo-controls").style.display, "none", "live mode hides demo controls");
    ctx.driveFrames(30);
    root.querySelectorAll(".station-card .station-count").forEach((node) => {
      assert.equal(node.textContent, "Unknown", "unfed station renders Unknown, never 0");
    });
    assert.equal(root.querySelector('[data-metric="mrr"]').textContent, "Unknown");
    assert.equal(root.querySelector('[data-metric="sentToday"]').textContent, "Unknown");
    assert.equal(root.querySelector('[data-metric="sitesBuilt"]').textContent, "Unknown");
    assert.equal(root.querySelectorAll(".packet.real").length, 0, "no real packets without real events");
    assert.equal(root.querySelectorAll(".revenue-burst").length, 0, "no revenue bursts without paid events");
    assert.equal(root.querySelectorAll(".reason-chip").length, 0);
    assert.equal(root.querySelectorAll(".ring").length, 0);
    assert.equal(root.querySelectorAll(".envelope").length, 0);
    assert.equal(root.querySelectorAll(".diag-item").length, 0, "no diagnostics without blocked/failed events");
    assert.equal(fetchCalls.length, 0, "the module itself never fetches");
  } finally { ctl.destroy(); }
});

test("duplicate event ids never replay", () => {
  const { ctx, ctl, root } = mount("live");
  try {
    const evt = { id: "prospect_123:42", type: "mined", at: Date.now(), station: "mine", payload: {} };
    assert.equal(ctl.pushEvent(evt), true, "first accept returns true");
    ctx.driveFrames(2);
    const packetsAfterFirst = root.querySelectorAll(".packet.real").length;
    assert.equal(packetsAfterFirst, 1);
    assert.equal(ctl.pushEvent(evt), false, "duplicate id returns false");
    ctx.driveFrames(6);
    assert.equal(root.querySelectorAll(".packet.real").length, 1, "still exactly one packet");
    assert.equal(ctl.pushEvent({ ...evt, type: "paid" }), false, "same id, different type is still a duplicate");
    ctx.driveFrames(4);
    assert.equal(root.querySelectorAll(".revenue-burst").length, 0, "duplicate never triggers a celebration");
  } finally { ctl.destroy(); }
});

test("blocked event parks at the failing station with a readable reason and a diagnostics row", () => {
  const { ctx, ctl, root } = mount("live");
  try {
    assert.equal(ctl.pushEvent({
      id: "row-9:gate_failed", type: "blocked", at: Date.now(), station: "qualify",
      payload: { reason: "Owner verification required" },
    }), true);
    ctx.driveFrames(3);
    const parked = root.querySelector(".packet.blocked");
    assert.ok(parked, "blocked packet exists");
    assert.equal(parked.style.left, "254px", "parks at the failing station (qualify), never downstream");
    const reason = root.querySelector(".reason-chip");
    assert.ok(reason, "reason chip readable");
    assert.match(reason.textContent, /Owner verification required/);
    const diag = root.querySelectorAll(".diag-item");
    assert.equal(diag.length, 1);
    assert.match(diag[0].textContent, /BLOCKED · QUALIFY · Owner verification required/);
    ctx.driveFrames(20);
    assert.equal(root.querySelectorAll(".packet.real").length, 0, "no continuation down the happy path");
  } finally { ctl.destroy(); }
});

test("qualified with a blocked payload visibly diverts to the waiting lane", () => {
  const { ctx, ctl, root } = mount("live");
  try {
    assert.equal(ctl.pushEvent({
      id: "row-4:qualified", type: "qualified", at: Date.now(), station: "qualify",
      payload: { blocked: true, reason: "Waiting on the owner's OK" },
    }), true);
    ctx.driveFrames(24); // ~1.2s: travel to the branch completes
    const diverted = root.querySelector(".packet.blocked");
    assert.ok(diverted, "packet diverts to the blocked/waiting branch");
    const reason = root.querySelector(".reason-chip");
    assert.match(reason.textContent, /Waiting on the owner's OK/);
    assert.equal(root.querySelectorAll(".station-card[data-station=\"build\"] .packet.real").length, 0);
  } finally { ctl.destroy(); }
});

test("paid event bursts +$199 and tweens MRR only to a supplied value", () => {
  const { ctx, ctl, root } = mount("live");
  try {
    assert.equal(ctl.pushEvent({
      id: "stripe:evt_1", type: "paid", at: Date.now(), station: "convert", payload: { mrr: 199 },
    }), true);
    ctx.driveFrames(24); // burst + ~800ms MRR tween
    assert.match(root.querySelector('[data-metric="mrr"]').textContent, /\$199/);
    assert.match(root.querySelector(".revenue-burst").textContent, /\+\$199/);
    // Without payload.mrr the module must not invent a number.
    assert.equal(ctl.pushEvent({ id: "stripe:evt_2", type: "paid", at: Date.now(), station: "convert", payload: {} }), true);
    ctx.driveFrames(24);
    assert.match(root.querySelector('[data-metric="mrr"]').textContent, /\$199/, "MRR unchanged by a mrr-less paid event");
  } finally { ctl.destroy(); }
});

test("setState drives stations/crew/theater as durable snapshot truth", () => {
  const { ctx, ctl, root } = mount("live");
  try {
    ctl.setState({
      stations: {
        mine: { status: "working", count: 18, note: "Mission Viejo plumbing" },
        qualify: { status: "idle", count: 4, note: "" },
        build: { status: "idle", count: null, note: "" },
        outreach: { status: "blocked", count: 41, note: "Delivery pause: bounce threshold crossed" },
        engage: { status: "idle", count: 7, note: "" },
        convert: { status: "idle", count: 2, note: "" },
      },
      theater: {
        stages: ["START", "MINE", "QUALIFY", "BUILD", "QUEUE", "APPROVE", "SEND"],
        currentIndex: 3,
        elapsedMs: 8200,
        currentBusiness: "Example Plumbing LLC",
        pausedReason: null,
      },
      metrics: { mrr: null, sentToday: 7, sitesBuilt: 3 },
      crew: { leadminer: "working", riley: "working", checkout: "resting" },
    });
    ctx.driveFrames(2);
    const counts = {};
    root.querySelectorAll(".station-card").forEach((card) => {
      counts[card.getAttribute("data-station")] = {
        status: card.getAttribute("data-status"),
        count: card.querySelector(".station-count").textContent,
        note: card.querySelector(".station-note").textContent,
      };
    });
    assert.equal(counts.mine.count, "18");
    assert.equal(counts.build.count, "Unknown", "null count stays Unknown");
    assert.equal(counts.outreach.status, "blocked");
    assert.match(counts.outreach.note, /Delivery pause: bounce threshold crossed/);
    assert.equal(root.querySelector(".business").textContent, "Example Plumbing LLC");
    assert.equal(root.querySelector(".elapsed").textContent, "Elapsed: 8.2s");
    assert.equal(root.querySelector(".crew-row[data-crew-row=\"leadminer\"] .crew-state").textContent, "working");
    assert.equal(root.querySelector('[data-metric="sentToday"]').textContent, "7");
    // Stage 3 (BUILD) is the current theater stage.
    const current = root.querySelectorAll(".stages .stage")[3];
    assert.ok(current.classList.contains("current"));
  } finally { ctl.destroy(); }
});

test("destroy tears the hero down completely", () => {
  const { ctx, ctl, root } = mount("demo");
  ctx.driveFrames(5);
  assert.ok(root);
  ctl.destroy();
  assert.equal(ctx.container.children.length, 0, "module DOM disappears");
  assert.equal(ctl.destroyed, true);
});
