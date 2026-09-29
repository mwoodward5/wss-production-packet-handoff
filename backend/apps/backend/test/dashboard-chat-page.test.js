"use strict";

// wss-ai.com/dashboard — the chat panel, driven the way a customer drives it.
//
// This does not grep the page for hopeful strings. It RUNS the page's own
// script in a fresh realm against a DOM thin enough to assert on, clicks the
// buttons, and reads the markup and the network calls that came out. The
// owner's standing rule is that a passing check is not proof and the rendered
// output is.
//
// Fails before this change: the page had no #chatsend, no #chatfiles, never
// called /api/connect/edit or /api/connect/upload, and the only action on the
// whole dashboard was a tel: link.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const DASHBOARD = path.resolve(__dirname, "../../labs-site/dashboard/index.html");
const LABS_VERCEL = path.resolve(__dirname, "../../labs-site/vercel.json");
const html = fs.readFileSync(DASHBOARD, "utf8");

const SLUG = "wss-test-poor-john-s-plumbing-parkville";
const BUSINESS = "Poor John's Plumbing";
const DOMAIN = `${SLUG}.wss-ai.com`;
const FILE_URL = `https://files.example.test/uploads/${SLUG}/abc.jpg`;

const SURFACE = {
  ok: true,
  businessName: BUSINESS,
  clientId: "WSS-1F9506",
  site: { available: true, url: `https://${DOMAIN}/`, host: DOMAIN, reason: "" },
  report: { available: false, url: "", grade: "", score: null, scored: 0, weakest: [], reason: "no_report_on_file" },
};

const DONE_EDIT = {
  jobId: "edit_1",
  at: "2026-08-08T10:00:00Z",
  updatedAt: "2026-08-08T10:00:20Z",
  message: "Make the phone number bigger.",
  attachments: [],
  status: "done",
  open: false,
  say: "That's live on your site. Give your page a refresh and you'll see it.",
  changedFiles: 1,
};

/**
 * A DOM that records listeners, so a test can actually press the buttons.
 */
async function openDashboard({ edits = { ok: true, edits: [] }, routes = {} } = {}) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(script, "the dashboard must keep its inline script");

  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, innerHTML: "", textContent: "", value: "", disabled: false, className: "", style: {},
        // A fixed-height scroller, the way the real #chatlog is.
        scrollTop: 0, scrollHeight: 900,
        listeners: {},
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      });
    }
    return elements.get(id);
  };

  const calls = [];
  const answer = (body, status = 200) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

  const sandbox = {
    console, setTimeout, clearTimeout, Promise, TextEncoder, TextDecoder,
    fetch(url, init) {
      calls.push({ url: String(url), init: init || {} });
      const key = String(url).split("?")[0];
      if (Object.prototype.hasOwnProperty.call(routes, key)) return routes[key](String(url), answer, init);
      if (key === "/api/connect/threads") return answer({ threads: [] });
      if (key === "/api/connect/site") return answer(SURFACE);
      if (key === "/api/connect/visibility") return answer({ ok: true, configured: true, points: [] });
      if (key === "/api/connect/edits") return answer(edits);
      return answer({}, 404);
    },
    document: { getElementById: (id) => element(id) },
    localStorage: {
      store: new Map(),
      getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
      setItem(k, v) { this.store.set(k, String(v)); },
      removeItem(k) { this.store.delete(k); },
    },
    location: { hash: "", pathname: "/dashboard" },
    history: { replaceState() {} },
    crypto: { subtle: { digest: () => Promise.reject(new Error("not used on the boot path")) } },
    FileReader: class {
      readAsDataURL(file) { setTimeout(() => this.onload({ target: this }), 0); this.result = file.__dataUrl; }
    },
  };
  sandbox.localStorage.setItem("wss_connect_token", "tenant-token-for-this-test");

  vm.runInNewContext(script[1], sandbox);
  const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((r) => setImmediate(r)); };
  await settle();

  const fire = async (id, type, event = {}) => {
    const handlers = element(id).listeners[type] || [];
    assert.ok(handlers.length, `#${id} has no ${type} handler — the control is not wired`);
    for (const fn of handlers) await fn(event);
    await settle();
  };
  return { el: (id) => element(id), calls, fire, settle };
}

const posts = (calls, url) => calls.filter((c) => c.url === url && c.init && c.init.method === "POST");
const bodyOf = (call) => JSON.parse(call.init.body);

// ---------------------------------------------------------------------------
// The two doors
// ---------------------------------------------------------------------------

test("chat and call are presented as two equal doors, not a link under a phone number", () => {
  const doors = [...html.matchAll(/<button\b[^>]*class="door(?: on| voice-door)?"[^>]*>/g)];
  assert.equal(doors.length, 2, "exactly two doors: message and in-browser voice");
  // The message door is a real BUTTON, not a decorated div: the element that
  // says "write it here" must do something when pressed (it focuses the
  // composer — see wirePresets), and a div with a click handler would be
  // invisible to a keyboard.
  assert.match(html, /<button class="door on" id="doorchat" type="button"[^>]*>[\s\S]*?<b>Message Riley<\/b>/);
  assert.match(html, /<button class="door voice-door" id="voicecall" type="button"[^>]*>[\s\S]*?<b>Talk it through<\/b>/);
  assert.doesNotMatch(html.slice(html.indexOf('id="panel-assistant"'), html.indexOf('id="panel-reports"')), /tel:\+19493395562/);
  // Same class, so the same size and weight — the equality is structural.
  assert.match(html, /\.doors\{display:grid;grid-template-columns:1fr 1fr/);
});

test("the composer takes both words and files", () => {
  assert.match(html, /<textarea id="chatinput"/);
  assert.match(html, /<input type="file" id="chatfiles" multiple accept="image\/png,image\/jpeg,image\/gif,image\/webp,application\/pdf"/);
  assert.match(html, /<button class="send" id="chatsend" type="button">/);
});

// ---------------------------------------------------------------------------
// Sending a change
// ---------------------------------------------------------------------------

test("the panel loads the customer's real change history on open", async () => {
  const { el, calls } = await openDashboard({ edits: { ok: true, edits: [DONE_EDIT] } });
  assert.ok(calls.some((c) => c.url === "/api/connect/edits"), "the panel must ask for the customer's own edits");
  const log = el("chatlog").innerHTML;
  assert.match(log, /Make the phone number bigger\./);
  assert.match(log, /That's live on your site/);
  assert.match(log, /class="state live">Live</);
});

test("typing a change and pressing send reads it back before anything is applied", async () => {
  const { el, calls, fire } = await openDashboard({
    routes: {
      "/api/connect/edit": (_u, answer) => answer({
        ok: true, status: "confirm_required", applied: false, queued: false,
        confirm: { business_name: BUSINESS, domain: DOMAIN, site_slug: SLUG },
        message: "Make the header phone number bigger.",
        attachments: [],
        confirm_token: "TOKEN-FOR-THIS-EXACT-CHANGE",
        say: `We'll make this change to ${BUSINESS} at ${DOMAIN}. Apply it?`,
      }),
    },
  });
  el("chatinput").value = "Make the header phone number bigger.";
  await fire("chatsend", "click");

  const sent = posts(calls, "/api/connect/edit");
  assert.equal(sent.length, 1);
  assert.equal(bodyOf(sent[0]).message, "Make the header phone number bigger.");
  assert.equal(bodyOf(sent[0]).confirm_token, undefined, "the first send must never carry a confirmation");

  const confirm = el("chatconfirm").innerHTML;
  assert.match(confirm, /Poor John&#39;s Plumbing|Poor John's Plumbing/);
  assert.match(confirm, new RegExp(DOMAIN.replace(/\./g, "\\.")));
  assert.match(confirm, /Apply the change/);
  assert.match(confirm, /Make the header phone number bigger\./);
});

test("tapping apply sends the confirmation and then re-reads the record", async () => {
  const seen = [];
  const { el, calls, fire } = await openDashboard({
    edits: { ok: true, edits: [{ ...DONE_EDIT, jobId: "edit_2", message: "Make the header phone number bigger." }] },
    routes: {
      "/api/connect/edit": (_u, answer, init) => {
        const body = JSON.parse(init.body);
        seen.push(body);
        if (!body.confirm_token) {
          return answer({
            ok: true, status: "confirm_required", confirm: { business_name: BUSINESS, domain: DOMAIN },
            message: body.message, attachments: [], confirm_token: "TOKEN", say: "Apply it?",
          });
        }
        return answer({ ok: true, status: "done", applied: true, jobId: "edit_2", say: "That's live." });
      },
    },
  });
  el("chatinput").value = "Make the header phone number bigger.";
  await fire("chatsend", "click");
  await fire("chatapply", "click");

  assert.equal(seen.length, 2);
  assert.equal(seen[1].confirm_token, "TOKEN");
  assert.equal(seen[1].message, seen[0].message, "the applied change is the one that was read back");
  assert.equal(el("chatinput").value, "", "a sent change clears the box");
  assert.equal(el("chatconfirm").innerHTML, "");
  // The outcome shown comes from the server's record, re-read after applying.
  assert.ok(calls.filter((c) => c.url === "/api/connect/edits").length >= 2);
  assert.match(el("chatlog").innerHTML, /That's live on your site/);
});

test("declining the read-back applies nothing", async () => {
  const { el, calls, fire } = await openDashboard({
    routes: {
      "/api/connect/edit": (_u, answer) => answer({
        ok: true, status: "confirm_required", confirm: { business_name: BUSINESS, domain: DOMAIN },
        message: "Delete the gallery.", attachments: [], confirm_token: "TOKEN", say: "Apply it?",
      }),
    },
  });
  el("chatinput").value = "Delete the gallery.";
  await fire("chatsend", "click");
  await fire("chatcancel", "click");
  assert.equal(el("chatconfirm").innerHTML, "");
  assert.equal(posts(calls, "/api/connect/edit").length, 1, "cancelling must not send a second request");
});

test("an empty box never reaches the server", async () => {
  const { el, calls, fire } = await openDashboard();
  el("chatinput").value = "   ";
  await fire("chatsend", "click");
  assert.equal(posts(calls, "/api/connect/edit").length, 0);
  assert.match(el("chaterr").textContent, /Type what you'd like changed/);
});

test("a rejected send says why and shows no confirmation", async () => {
  const { el, fire } = await openDashboard({
    routes: {
      "/api/connect/edit": (_u, answer) => answer({ ok: false, status: "busy", say: "Your last change is still going through." }, 409),
    },
  });
  el("chatinput").value = "Another change.";
  await fire("chatsend", "click");
  assert.equal(el("chatconfirm").innerHTML, "");
  assert.match(el("chaterr").textContent, /still going through/);
});

test("needs_input is a friendly Riley turn, never an error or Apply button", async () => {
  const { el, calls, fire } = await openDashboard({
    routes: {
      "/api/connect/edit": (_u, answer) => answer({
        ok: true,
        status: "needs_input",
        say: "What names and photos should I use for the team section?",
      }),
    },
  });
  el("chatinput").value = "Add a team section.";
  await fire("chatsend", "click");

  assert.equal(posts(calls, "/api/connect/edit").length, 1);
  assert.match(el("rileychat").innerHTML, /Riley/);
  assert.match(el("rileychat").innerHTML, /What names and photos/);
  assert.equal(el("chaterr").textContent, "");
  assert.equal(el("chatconfirm").innerHTML, "");
  assert.equal(el("chatinput").value, "");
  assert.match(el("chatinput").placeholder, /Answer Riley here/);
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

test("attaching a photo uploads it and carries the stored link into the change", async () => {
  const { el, calls, fire } = await openDashboard({
    routes: {
      "/api/connect/upload": (_u, answer) => answer({
        ok: true, attachment: { url: FILE_URL, name: "new truck.jpg", kind: "photo", bytes: 2048 },
      }),
      "/api/connect/edit": (_u, answer, init) => answer({
        ok: true, status: "confirm_required", confirm: { business_name: BUSINESS, domain: DOMAIN },
        message: JSON.parse(init.body).message, attachments: JSON.parse(init.body).attachments,
        confirm_token: "TOKEN", say: "Apply it?",
      }),
    },
  });

  const file = { name: "new truck.jpg", type: "image/jpeg", __dataUrl: "data:image/jpeg;base64,/9j/4AAQ" };
  await fire("chatfiles", "change", { target: { files: [file], value: "" } });

  const uploaded = posts(calls, "/api/connect/upload");
  assert.equal(uploaded.length, 1, "the file goes to the server as soon as it is chosen");
  assert.equal(bodyOf(uploaded[0]).name, "new truck.jpg");
  assert.match(bodyOf(uploaded[0]).data, /^data:image\/jpeg;base64,/);
  assert.match(el("chatchips").innerHTML, /new truck\.jpg/);

  el("chatinput").value = "Put this on the front.";
  await fire("chatsend", "click");
  const sent = bodyOf(posts(calls, "/api/connect/edit")[0]);
  assert.deepEqual(sent.attachments, [{ url: FILE_URL, name: "new truck.jpg", kind: "photo" }]);
  assert.match(el("chatconfirm").innerHTML, /new truck\.jpg/, "the customer sees the file they are approving");
});

test("a file the server refuses is reported, and never pretended into the request", async () => {
  const { el, calls, fire } = await openDashboard({
    routes: {
      "/api/connect/upload": (_u, answer) => answer({ ok: false, reason: "svg_refused", say: "That's a vector graphic, send a PNG or a JPEG." }, 400),
    },
  });
  const file = { name: "logo.svg", type: "image/svg+xml", __dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" };
  await fire("chatfiles", "change", { target: { files: [file], value: "" } });
  assert.equal(posts(calls, "/api/connect/upload").length, 0, "an unsupported type is not even sent");
  assert.match(el("chaterr").textContent, /photos \(JPEG, PNG, GIF or WebP\) and PDFs/);
  assert.equal(el("chatchips").innerHTML, "", "nothing may appear attached that is not stored");
});

test("a file a customer cannot send from here says so rather than failing silently", async () => {
  const { el, calls, fire } = await openDashboard();
  // A PDF past the cap cannot be resized, so it is refused locally with the reason.
  const huge = "A".repeat(5_000_000);
  const file = { name: "catalogue.pdf", type: "application/pdf", __dataUrl: `data:application/pdf;base64,${huge}` };
  await fire("chatfiles", "change", { target: { files: [file], value: "" } });
  assert.equal(posts(calls, "/api/connect/upload").length, 0);
  assert.match(el("chaterr").textContent, /too big to send/);
});

// ---------------------------------------------------------------------------
// Honest empty and failed states
// ---------------------------------------------------------------------------

test("the newest turn is the one in view, not the oldest", async () => {
  // Measured on the shipped page: the log is a 340px scroller and the
  // conversation reads downward, so a customer with a few past changes opened
  // the panel on their OLDEST request and the one they had just sent rendered
  // below the fold — which reads exactly like nothing happened.
  const { el } = await openDashboard({
    edits: { ok: true, edits: [DONE_EDIT, { ...DONE_EDIT, jobId: "edit_0", message: "An older one." }] },
  });
  assert.equal(el("chatlog").scrollTop, el("chatlog").scrollHeight);
});

test("no changes yet says exactly that", async () => {
  const { el } = await openDashboard({ edits: { ok: true, edits: [] } });
  assert.match(el("chatlog").innerHTML, /No changes asked for yet/);
});

test("a history that could not be read is not drawn as an empty one", async () => {
  const { el } = await openDashboard({ edits: { ok: false, edits: [], reason: "history_unreadable" } });
  assert.match(el("chatlog").innerHTML, /couldn’t load your change history/);
  assert.doesNotMatch(el("chatlog").innerHTML, /No changes asked for yet/);
});

test("a refused change is not shown as live", async () => {
  const refused = { ...DONE_EDIT, status: "refused", open: false, say: "I can't add that unless it's something you can back up." };
  const { el } = await openDashboard({ edits: { ok: true, edits: [refused] } });
  const log = el("chatlog").innerHTML;
  assert.match(log, /class="state stop">Not applied</);
  assert.match(log, /something you can back up/);
  assert.doesNotMatch(log, /state live/);
});

// ---------------------------------------------------------------------------
// Contracts the page depends on
// ---------------------------------------------------------------------------

test("every chat endpoint is same-origin, which the page's own CSP requires", () => {
  for (const route of ["/api/connect/edit", "/api/connect/edits", "/api/connect/upload"]) {
    assert.ok(html.includes(`fetch("${route}"`), `the page must call ${route} same-origin`);
  }
  const config = JSON.parse(fs.readFileSync(LABS_VERCEL, "utf8"));
  for (const route of ["/api/connect/edit", "/api/connect/edits", "/api/connect/upload"]) {
    const rewrite = config.rewrites.find((r) => r.source === route);
    assert.ok(rewrite, `wss-ai.com must proxy ${route} to the backend`);
    assert.equal(rewrite.destination, `https://ghost-agency-backend.vercel.app${route}`);
  }
  const csp = config.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /connect-src 'self'/, "the same-origin rule these rewrites exist for must stay");
  assert.match(csp, /img-src 'self' data:/, "local file previews are data: URIs — no remote image host is opened up");
});

test("the panel polls only while something is actually running, and not forever", () => {
  assert.match(html, /if\(!open\)\{pollGaveUp=false;pollUntil=0;return;\}/);
  assert.match(html, /if\(now>=pollUntil\)\{pollGaveUp=true;renderLog\(edits\);editTheaterWatchStopped\(\);return;\}/);
});

test("the poll window outlasts the server's own ceiling, and stops in words", () => {
  // The old budget was 45 polls x 4s = 3 minutes, and it expired in SILENCE —
  // the chip kept saying "Working" for ever. Three minutes was also shorter
  // than the runner's ceiling, so a slow-but-fine edit could never be watched
  // all the way to its answer. Both halves are asserted here.
  const { EDIT_DEADLINE_MS } = require("../lib/edit-job-runner");
  const window = Number(/POLL_WINDOW_MS=(\d+)/.exec(html)[1]);
  assert.ok(window > EDIT_DEADLINE_MS, `poll window ${window}ms must outlast the runner's ${EDIT_DEADLINE_MS}ms`);
  assert.match(html, /we’ve stopped watching it live/);
});
