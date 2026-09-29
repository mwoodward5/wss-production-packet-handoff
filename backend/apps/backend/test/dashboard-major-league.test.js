"use strict";

// test/dashboard-major-league.test.js — the first five seconds and after.
//
// Three surfaces this file pins, all by RUNNING the dashboard's own script the
// way the other dashboard suites do (rendered output is the proof, a hopeful
// string is not):
//
//   1. THE WELCOME MOMENT. A magic-link arrival (#t=…) gets one short
//      handshake — the business's name large, one true line, then the live
//      dashboard. It never plays for a direct sign-in and never twice in one
//      session.
//   2. APPOINTMENTS, PROMOTED. The booking link is a first-class panel on the
//      Assistant tab, and the service mark is link intelligence: it appears
//      only while a link is set, it names whose page the link points at, and
//      it never claims anything is connected.
//   3. THIS WEEK. One plain sentence, every number measured by an endpoint
//      that already exists. A source that did not answer contributes no
//      clause; when nothing can be measured the card says nothing at all.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const DASHBOARD = path.resolve(__dirname, "../../labs-site/dashboard/index.html");
const html = fs.readFileSync(DASHBOARD, "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const iso = (ms) => new Date(ms).toISOString();

// The same Monday-UTC week start the threads summary uses server-side, so
// "inside this week" timestamps can be placed deterministically no matter
// when the suite runs.
function utcWeekStartMs(now = new Date()) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = new Date(midnight).getUTCDay();
  return midnight - ((day + 6) % 7) * DAY;
}

const DEFAULT_SURFACE = {
  ok: true,
  businessName: "",
  site: { available: false, reason: "no_site_on_file" },
  report: { available: false, reason: "no_report_on_file" },
};

/**
 * Boots the dashboard's inline script against a recording DOM, controllable
 * timers and a stubbed fetch. `deferSite` leaves /api/connect/site hanging on
 * a promise the test releases itself, which is how the first-paint skeleton
 * state is observed.
 */
async function bootPage({
  hash = "",
  storedToken = null,
  session = {},
  magicLink = null,
  threads = { threads: [] },
  surface = null,
  assistant = { ok: true, settings: {}, activity: [] },
  deferSite = false,
} = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        innerHTML: "",
        textContent: "",
        value: "",
        disabled: false,
        className: "",
        style: {},
        listeners: {},
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      });
    }
    return elements.get(id);
  };

  const timers = new Map();
  let timerSeq = 0;
  const fakeSetTimeout = (fn, delay) => {
    const id = ++timerSeq;
    timers.set(id, { fn, delay: Number(delay) || 0 });
    return id;
  };
  const fakeClearTimeout = (id) => timers.delete(id);

  const calls = [];
  const answer = (body, status = 200) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

  let releaseSite = null;
  const fetchStub = (url) => {
    calls.push(String(url));
    const key = String(url).split("?")[0];
    if (key === "/api/connect/verify-link") {
      return magicLink ? answer(magicLink, 200) : answer({ ok: false }, 400);
    }
    if (key === "/api/connect/threads") return answer(threads);
    if (key === "/api/connect/site") {
      if (deferSite) return new Promise((resolve) => { releaseSite = () => resolve(answer(surface || DEFAULT_SURFACE)); });
      return answer(surface || DEFAULT_SURFACE);
    }
    if (key === "/api/connect/visibility") return answer({ ok: true, configured: false, points: [] });
    if (key === "/api/connect/edits") return answer({ ok: true, edits: [] });
    if (key === "/api/connect/assistant") return answer(assistant);
    return answer({}, 404);
  };

  const makeStore = (seed) => {
    const store = new Map(Object.entries(seed));
    return {
      store,
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); },
    };
  };
  const localStorage = makeStore({});
  if (storedToken) localStorage.setItem("wss_connect_token", storedToken);
  const sessionStorage = makeStore(session);

  const sandbox = {
    Promise, Date, Number, URL, console,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    fetch: fetchStub,
    document: { getElementById: element, addEventListener() {} },
    localStorage,
    sessionStorage,
    location: { hash, pathname: "/dashboard" },
    history: { replaceState() {} },
    TextEncoder, TextDecoder,
  };

  vm.runInNewContext(script, sandbox);
  const settle = async () => { for (let i = 0; i < 60; i += 1) await new Promise((r) => setImmediate(r)); };
  await settle();

  return {
    el: element,
    calls,
    sessionStorage,
    settle,
    releaseSite: async () => { assert.ok(releaseSite, "site fetch was not deferred"); releaseSite(); await settle(); },
    async fire(id, type = "click", event = {}) {
      for (const fn of element(id).listeners[type] || []) await fn(event);
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

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const next = html.indexOf("\n  function ", start + 12);
  return html.slice(start, next < 0 ? html.length : next);
}

function visibleCopy() {
  return html
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ");
}

// ---------------------------------------------------------------------------
// 1. THE WELCOME MOMENT
// ---------------------------------------------------------------------------

test("a magic-link arrival plays the welcome once, then hands over the dashboard", async () => {
  const page = await bootPage({
    hash: "#t=sekrit-link",
    magicLink: { ok: true, token: "scoped-welcome-token", businessName: "Poor John's Plumbing" },
    threads: { threads: [], summary: { unrepliedCount: 0, newLeads: { count: 0, thisWeek: 0 } } },
    surface: { ...DEFAULT_SURFACE, businessName: "Poor John's Plumbing" },
  });

  assert.ok(page.calls.includes("/api/connect/verify-link?t=sekrit-link"),
    "the #t= fragment must be exchanged for the scoped token");
  assert.equal(page.el("welcomename").textContent, "Poor John's Plumbing",
    "the business's name is the headline of the moment");
  assert.equal(page.el("welcomeshade").hidden, false, "the handshake is on screen");
  assert.match(page.el("welcomeshade").className, /\bon\b/);
  assert.equal(page.sessionStorage.getItem("wss_dash_welcome"), "1",
    "the moment marks itself seen for this session");

  const hold = Number(/WELCOME_HOLD_MS=(\d+)/.exec(html)[1]);
  const fade = Number(/WELCOME_FADE_MS=(\d+)/.exec(html)[1]);
  assert.ok(hold >= 600 && hold <= 800, `the intro must sit inside 600-800ms, not ${hold}`);
  await page.runTimer(hold);
  assert.doesNotMatch(page.el("welcomeshade").className, /\bon\b/, "the fade has started");
  assert.equal(page.el("welcomeshade").hidden, false, "still visible while it fades out");
  await page.runTimer(fade);
  assert.equal(page.el("welcomeshade").hidden, true, "the dashboard is fully handed over");
});

test("a direct sign-in never sees the welcome at all", async () => {
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    threads: { threads: [], summary: { unrepliedCount: 0 } },
  });
  assert.ok(!page.calls.some((call) => call.startsWith("/api/connect/verify-link")),
    "no magic link was present, so none is exchanged");
  assert.equal(page.el("welcomename").textContent, "");
  assert.notEqual(page.el("welcomeshade").hidden, false, "the shade was never switched on");
  assert.doesNotMatch(page.el("welcomeshade").className, /\bon\b/);
  assert.equal(page.sessionStorage.getItem("wss_dash_welcome"), null,
    "a moment that never played is not marked as played");
});

test("the welcome never replays within a session, even via a second magic link", async () => {
  const page = await bootPage({
    hash: "#t=second-link",
    magicLink: { ok: true, token: "scoped-token-2", businessName: "Poor John's Plumbing" },
    session: { wss_dash_welcome: "1" },
  });
  assert.equal(page.el("welcomename").textContent, "");
  assert.notEqual(page.el("welcomeshade").hidden, false);
  assert.doesNotMatch(page.el("welcomeshade").className, /\bon\b/);
});

test("the welcome cannot block or capture anything, and says one true line", () => {
  assert.match(html, /id="welcomeshade"[^>]*hidden[^>]*aria-hidden="true"/,
    "the shade is decorative: hidden from assistive tech until it plays");
  assert.match(html, /\.welcome-shade\{[^}]*pointer-events:none/,
    "a pointer must pass straight through to the dashboard");
  assert.match(html, /\.welcome-shade\[hidden\]\{display:none\}/);
  assert.match(html, /Your website HQ is ready\./);
  // The dismissal is not only the timer's job: any touch hands the page over.
  const source = functionSource("playWelcomeOnce");
  assert.match(source, /pointerdown/, "any touch of the page dismisses the handshake");
  assert.match(source, /keydown/);
});

test("first paint shows the shape of the answer, never an empty shell", async () => {
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    threads: { threads: [] }, // no summary -> the leads metric cannot be measured
    deferSite: true,
  });

  // The site surface is still in flight: the two metrics it feeds show
  // professional skeletons, not blank slots and not invented numbers.
  assert.match(page.el("metric-calls").className, /skelcard/);
  assert.match(page.el("metric-calls").innerHTML, /skelbar/);
  assert.match(page.el("metric-site").className, /skelcard/);
  assert.doesNotMatch(page.el("metric-calls").innerHTML, /\d/);

  await page.releaseSite();
  // Once the source settles, the skeleton resolves to the real card state —
  // here a true absence, drawn as cleared rather than frozen as a shimmer.
  assert.doesNotMatch(page.el("metric-calls").className, /skelcard/);
  assert.doesNotMatch(page.el("metric-calls").innerHTML, /skelbar/);
});

// ---------------------------------------------------------------------------
// 2. APPOINTMENTS, PROMOTED
// ---------------------------------------------------------------------------

test("Appointments is a panel of its own on the Assistant tab, above the settings it came from", () => {
  const assistantStart = html.indexOf('id="panel-assistant"');
  const assistantEnd = html.indexOf('id="panel-reports"');
  const slice = html.slice(assistantStart, assistantEnd);
  const editor = slice.indexOf('id="editor-runway"');
  const appt = slice.indexOf('id="apptbody"');
  const settings = slice.indexOf('id="asettings"');
  assert.ok(editor >= 0 && appt > editor && settings > appt,
    "the booking link used to be the last row of the settings list; it now leads them");
  assert.match(slice, /<h2 id="appt-heading">[\s\S]*?Appointments<\/h2>/);
  assert.match(visibleCopy(), /sends them straight to the page you already use/);
  assert.doesNotMatch(html, /Works with|bookingwith|bwmark/,
    "the decorative always-on badges are gone");
});

test("badge visibility follows link state: no link, no marks", async () => {
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    assistant: { ok: true, settings: { bookingUrl: "" }, activity: [] },
  });
  const live = page.el("apptlive").innerHTML;
  assert.match(live, /No booking page set/);
  assert.doesNotMatch(live, /<svg/, "with nothing set there is no mark to show");
  assert.doesNotMatch(live, /Calendly|Cal\.com|Google Calendar|Your booking page/);
  assert.match(page.el("apptbody").innerHTML, /id="apptsave"[^>]* disabled/,
    "nothing to save until something changes");
});

test("a recognized domain shows exactly its own mark, and the host it points at", async () => {
  const cases = [
    ["https://calendly.com/acme-plumbing/estimate", "Calendly page", /calendly\.com/],
    ["https://acme.cal.com/30min", "Cal.com page", /acme\.cal\.com/],
    ["https://calendar.google.com/calendar/appointments/ACME", "Google Calendar page", /calendar\.google\.com/],
  ];
  for (const [url, label, hostRe] of cases) {
    const page = await bootPage({
      storedToken: "tenant-token-for-this-test",
      assistant: { ok: true, settings: { bookingUrl: url }, activity: [] },
    });
    assert.match(page.el("apptbody").innerHTML, new RegExp(`value="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      "the stored link is in the field, front and center");
    const live = page.el("apptlive").innerHTML;
    assert.match(live, new RegExp(label), `${url} earns its own mark`);
    assert.match(live, hostRe);
    for (const other of cases.map(([u, l]) => l)) {
      if (other !== label) assert.doesNotMatch(live, new RegExp(other), `${url} shows only ${label}`);
    }
  }
});

test("a real link nobody recognizes gets the neutral mark, never a wrong logo", async () => {
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    assistant: { ok: true, settings: { bookingUrl: "https://bookings.example.com/acme" }, activity: [] },
  });
  const live = page.el("apptlive").innerHTML;
  assert.match(live, /Your booking page/);
  assert.doesNotMatch(live, /Calendly|Cal\.com|Google Calendar/);
});

test("typing a link updates the mark live and lights the save", async () => {
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    assistant: { ok: true, settings: { bookingUrl: "" }, activity: [] },
  });
  await page.fire("abooking", "input", { target: { value: "https://cal.com/acme-plumbing/estimate" } });
  assert.match(page.el("apptlive").innerHTML, /Cal\.com page/,
    "the chip follows the field character for character");
  // markDirty must light the Appointments save (parsed state simulated: the
  // button rendered disabled until the draft changed).
  page.el("apptsave").disabled = true;
  await page.fire("abooking", "input", { target: { value: "https://cal.com/acme-plumbing/estimate" } });
  assert.equal(page.el("apptsave").disabled, false);
  assert.match(page.el("apptnote").textContent, /aren.t saved yet/);
});

test("the marks are link intelligence, never an integration claim", () => {
  const copy = visibleCopy();
  for (const word of ["integration", "integrates", "synced with", "connected to"]) {
    assert.doesNotMatch(copy, new RegExp(word, "i"), `customer copy claims "${word}"`);
  }
  const intro = functionSource("paintApptPreview");
  assert.match(intro, /bookingService\(/);
  assert.match(functionSource("bookingService"), /calendly\.com/);
  assert.match(functionSource("bookingService"), /\.cal\.com/);
  assert.match(functionSource("bookingService"), /calendar\.google\.com/);
});

// ---------------------------------------------------------------------------
// 3. THIS WEEK — one plain sentence, every number measured
// ---------------------------------------------------------------------------

test("the glance card says the week in plain words from measured sources", async () => {
  const weekStart = utcWeekStartMs();
  const overview = {
    siteStatus: { state: "ready", label: "Site is ready" },
    calls: {
      complete: true,
      rangeDays: 14,
      items: [
        { id: "c1", at: iso(weekStart + 60 * MINUTE), answered: true, outcome: "Estimate booked" },
        { id: "c2", at: iso(weekStart + 2 * 60 * MINUTE), answered: true, outcome: "Quote question" },
        { id: "c3", at: iso(weekStart - 8 * DAY), answered: true, outcome: "An old call" },
        { id: "c4", at: iso(weekStart + 3 * 60 * MINUTE), answered: false, outcome: "No answer" },
      ],
    },
    lastEdit: { at: iso(weekStart + 40 * MINUTE), summary: "Updated the hours." },
    editActivity: [
      { at: iso(weekStart + 40 * MINUTE), summary: "Updated the hours." },
      { at: iso(weekStart - 9 * DAY), summary: "An older edit." },
    ],
    reportAction: null,
    sources: { site: true, report: true, edits: true, calls: true },
  };
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    threads: {
      threads: [],
      summary: {
        newLeads: { count: 4, thisWeek: 3, previousWeek: 1, changeVsPreviousWeek: 2, weekStartedAt: iso(weekStart) },
        unrepliedCount: 0,
        recentLeads: [],
        byThread: {},
      },
    },
    surface: { ...DEFAULT_SURFACE, overview },
  });

  const card = page.el("weekglance");
  assert.equal(card.hidden, false);
  assert.match(card.innerHTML, /This week/);
  assert.match(card.innerHTML, /3 new leads · 2 calls handled · 1 change made/,
    "the server's week boundary, the answered flag and the edit timestamps — nothing else");
});

test("a source that did not answer contributes no clause, and no number is invented", async () => {
  const weekStart = utcWeekStartMs();
  const overview = {
    siteStatus: { state: "ready", label: "Site is ready" },
    calls: {
      complete: true,
      rangeDays: 14,
      items: [
        { id: "c1", at: iso(weekStart + 60 * MINUTE), answered: true, outcome: "Estimate booked" },
        { id: "c2", at: iso(weekStart + 2 * 60 * MINUTE), answered: true, outcome: "Quote question" },
        { id: "c3", at: iso(weekStart - 8 * DAY), answered: true, outcome: "An old call" },
      ],
    },
    lastEdit: { at: iso(weekStart - 9 * DAY), summary: "An older edit." },
    editActivity: [{ at: iso(weekStart - 9 * DAY), summary: "An older edit." }],
    reportAction: null,
    sources: { site: true, report: true, edits: true, calls: true },
  };
  // No threads summary: the leads count cannot be measured, so it is absent.
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    threads: { threads: [] },
    surface: { ...DEFAULT_SURFACE, overview },
  });

  const card = page.el("weekglance").innerHTML;
  assert.match(card, /2 calls handled/);
  assert.doesNotMatch(card, /new lead|change made/,
    "nothing may be said about a source that never answered");
});

test("with nothing measurable, the card omits itself entirely", async () => {
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    threads: { threads: [] },          // no summary
    surface: DEFAULT_SURFACE,          // no overview
  });
  const card = page.el("weekglance");
  assert.equal(card.hidden, true, "an unmeasurable week is silence, not a zero");
  assert.equal(card.innerHTML, "");
});

test("a measured, quiet week says that in one true sentence", async () => {
  const weekStart = utcWeekStartMs();
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    threads: { threads: [], summary: { newLeads: { count: 0, thisWeek: 0, weekStartedAt: iso(weekStart) }, unrepliedCount: 0 } },
    surface: {
      ...DEFAULT_SURFACE,
      overview: {
        siteStatus: { state: "ready", label: "Site is ready" },
        calls: { complete: true, rangeDays: 14, items: [] },
        lastEdit: null,
        editActivity: [],
        reportAction: null,
        sources: { site: true, report: true, edits: true, calls: true },
      },
    },
  });
  const card = page.el("weekglance");
  assert.equal(card.hidden, false);
  assert.match(card.innerHTML, /Nothing new this week yet\./);
  assert.doesNotMatch(card.innerHTML, /\d/, "no count is printed for a week with nothing in it");
});

test("a list that fills the whole week admits it may be longer than the page", async () => {
  const weekStart = utcWeekStartMs();
  const activity = [];
  for (let i = 0; i < 8; i += 1) activity.push({ at: iso(weekStart + (i + 1) * MINUTE), summary: "A change." });
  const page = await bootPage({
    storedToken: "tenant-token-for-this-test",
    threads: { threads: [] }, // summary measured as zero this week, so no leads clause
    surface: {
      ...DEFAULT_SURFACE,
      overview: {
        siteStatus: { state: "ready", label: "Site is ready" },
        calls: {
          complete: true,
          rangeDays: 14,
          items: [{ id: "c1", at: iso(weekStart + 60 * MINUTE), answered: true, outcome: "Call" },
                  { id: "c2", at: iso(weekStart + 61 * MINUTE), answered: true, outcome: "Call" }],
        },
        lastEdit: activity[0],
        editActivity: activity,
        reportAction: null,
        sources: { site: true, report: true, edits: true, calls: true },
      },
    },
  });
  const card = page.el("weekglance").innerHTML;
  // Both returned lists are entirely inside the week, so the endpoint may have
  // paged: the counts are floors, and the card says so with a "+".
  assert.match(card, /2\+ calls handled/);
  assert.match(card, /8\+ changes made/);
});

test("the week card is pinned to the real response fields and nothing else", () => {
  const source = functionSource("renderWeekGlance");
  assert.match(source, /newLeads/);
  assert.match(source, /thisWeek/);
  assert.match(source, /answered===true/);
  assert.match(source, /editActivity/);
  assert.match(source, /complete===true/);
  assert.match(source, /el\.hidden=true;\s*el\.innerHTML="";/);
  const start = functionSource("weekStartMs");
  assert.match(start, /weekStartedAt/, "the server's own week boundary is preferred when present");
});

// ---------------------------------------------------------------------------
// The craft layer, pinned where it is structural
// ---------------------------------------------------------------------------

test("the craft layer: one motion vocabulary, live skeletons, 8px rhythm", () => {
  assert.match(html, /transition:border-color \.18s ease,background-color \.18s ease,color \.18s ease,box-shadow \.18s ease,transform \.18s ease/,
    "every interactive surface answers the pointer in the same 180ms");
  assert.match(html, /transform:scale\(\.97\)/, "tap feedback is pressed, not just recolored");
  assert.match(html, /@keyframes panel-in/, "tab changes ease in");
  assert.match(html, /@keyframes tabline/);
  assert.match(html, /@keyframes skelwash/, "skeletons shimmer while they wait");
  assert.match(html, /\.metric\.skelcard/);
  assert.match(html, /\.panel\{background:var\(--carbon\);border:1px solid var\(--hair\);border-radius:16px;padding:24px\}/,
    "the spacing rhythm is the 8px system");
  assert.match(html, /:focus-visible\{outline:3px solid var\(--green\)/,
    "the focus ring survives the polish");
});
