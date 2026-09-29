"use strict";

// wss-ai.com/dashboard — what the customer actually sees.
//
// This does not grep the page for hopeful strings; it RUNS the page's own
// script against a fake DOM and a stubbed fetch, then reads the markup that
// came out. The owner's standing rule is that a passing check is not proof and
// the rendered output is, and a static assertion about source text would have
// happily passed on the version of this page that rendered a hardcoded
// "Your managed site" with no link on it.
//
// Fails before the 2026-08-08 change: the page had no #sitebody, no
// /api/connect/site call, and printed "No scored reports on file yet" for a
// business whose report we can read.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const DASHBOARD = path.resolve(__dirname, "../../labs-site/dashboard/index.html");
const LABS_VERCEL = path.resolve(__dirname, "../../labs-site/vercel.json");
const html = fs.readFileSync(DASHBOARD, "utf8");

const SITE = "https://wss-test-poor-john-s-plumbing-parkville.wss-ai.com/";
const REPORT = "https://callprep.wss-ai.com/report/d5a8a810-b39b-4d9a-886f-e694465a0d7b";

const FULL_SURFACE = {
  ok: true,
  businessName: "Poor John's Plumbing",
  clientId: "WSS-1F9506",
  site: { available: true, url: SITE, host: "wss-test-poor-john-s-plumbing-parkville.wss-ai.com", reason: "" },
  report: {
    available: true,
    url: REPORT,
    grade: "B",
    score: 83,
    scored: 8,
    weakest: [
      { key: "socialMedia", label: "Social Media", grade: "F", score: 40 },
      { key: "businessIntelligence", label: "Business Intelligence", grade: "F", score: 40 },
      { key: "security", label: "Website Security", grade: "C", score: 75 },
    ],
    reason: "",
  },
};

const EMPTY_SURFACE = {
  ok: true,
  businessName: "",
  clientId: "",
  site: { available: false, url: "", host: "", reason: "no_site_on_file" },
  report: { available: false, url: "", grade: "", score: null, scored: 0, weakest: [], reason: "no_report_on_file" },
};

/**
 * Runs the dashboard's inline script in a fresh realm with a DOM thin enough to
 * assert on and a fetch that answers exactly what the test says it does.
 * Returns the element map so a test can read innerHTML/textContent.
 */
async function renderDashboard({ threads = [], surface = FULL_SURFACE, visibility = null, routes = {} } = {}) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(script, "the dashboard must keep its inline script");

  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, { id, innerHTML: "", textContent: "", style: {}, addEventListener() {}, value: "" });
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
    console,
    setTimeout,
    fetch(url) {
      calls.push(String(url));
      const key = String(url).split("?")[0];
      if (Object.prototype.hasOwnProperty.call(routes, key)) return routes[key](String(url), answer);
      if (key === "/api/connect/threads") return answer({ threads });
      if (key === "/api/connect/site") return answer(surface);
      if (key === "/api/connect/visibility") {
        return visibility ? answer(visibility) : answer({ ok: true, configured: true, points: [], latest: null, delta: null });
      }
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
    TextEncoder, TextDecoder,
  };
  sandbox.localStorage.setItem("wss_connect_token", "tenant-token-for-this-test");

  vm.runInNewContext(script[1], sandbox);
  for (let i = 0; i < 60; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return { el: (id) => element(id), calls };
}

// ---------------------------------------------------------------------------
// ITEM 1 — the site is reachable from the page about the site
// ---------------------------------------------------------------------------

test("the website card links the customer's live site", async () => {
  const { el, calls } = await renderDashboard();
  const body = el("sitebody").innerHTML;
  assert.ok(calls.includes("/api/connect/site"), "the page must ask for the customer's site");
  assert.match(body, new RegExp(`href="${SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(body, /Visit your website/);
  assert.match(body, /wss-test-poor-john-s-plumbing-parkville\.wss-ai\.com/);
  assert.doesNotMatch(body, /Your managed site/, "the hardcoded placeholder must be gone");
});

test("the page identifies the customer instead of saying nothing", async () => {
  const { el } = await renderDashboard();
  assert.equal(el("whoname").textContent, "Poor John's Plumbing");
  assert.match(el("clientid").textContent, /WSS-1F9506/);
  assert.match(el("rileyid").innerHTML, /WSS-1F9506/);
});

test("no site on file renders a true sentence and zero links", async () => {
  const { el } = await renderDashboard({ surface: EMPTY_SURFACE });
  const body = el("sitebody").innerHTML;
  assert.match(body, /isn't on file here yet/);
  assert.doesNotMatch(body, /href=/, "an empty state must never render a link to nowhere");
});

test("an ambiguous login refuses to show a website rather than guess", async () => {
  const surface = JSON.parse(JSON.stringify(EMPTY_SURFACE));
  surface.site.reason = "multiple_sites_claim_this_login";
  const { el } = await renderDashboard({ surface });
  assert.match(el("sitebody").innerHTML, /won't guess which is yours/);
  assert.doesNotMatch(el("sitebody").innerHTML, /href="http/);
});

test("a failed site lookup says so on both cards and invents nothing", async () => {
  const { el } = await renderDashboard({
    routes: { "/api/connect/site": (_url, answer) => answer({ ok: false }, 500) },
  });
  assert.match(el("sitebody").innerHTML, /couldn't load your site details/);
  assert.match(el("gradehead").innerHTML, /couldn’t load your visibility report/);
  assert.doesNotMatch(el("gradehead").innerHTML, /grade-letter/);
});

// ---------------------------------------------------------------------------
// ITEM 3 — the report we already hold shows up in the GetFound card
// ---------------------------------------------------------------------------

test("the GetFound card shows the grade, the score, the weakest areas and the report link", async () => {
  const { el } = await renderDashboard();
  const head = el("gradehead").innerHTML;
  assert.match(head, /class="grade-letter good">B</);
  assert.match(head, /83\/100/);
  assert.match(head, /8 areas scored/);
  assert.match(head, /Weakest areas/);
  assert.match(head, /Social Media<b>F 40<\/b>/);
  assert.match(head, /Business Intelligence<b>F 40<\/b>/);
  assert.match(head, new RegExp(`href="${REPORT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(head, /Open your full report/);
  assert.doesNotMatch(head, /No scored reports on file yet/);
});

test("an unreadable report shows no grade at all — no fallback letter", async () => {
  const surface = JSON.parse(JSON.stringify(FULL_SURFACE));
  surface.report = { available: false, url: REPORT, grade: "", score: null, scored: 0, weakest: [], reason: "timeout" };
  const { el } = await renderDashboard({ surface });
  const head = el("gradehead").innerHTML;
  assert.match(head, /couldn’t read the grade just now/);
  assert.doesNotMatch(head, /grade-letter/, "no letter may be printed when the report did not yield one");
  assert.doesNotMatch(head, /\/100/);
  assert.match(head, /Open your full report/, "the customer can still open their own report");
});

test("a report with nothing scored says that, and is not an F", async () => {
  const surface = JSON.parse(JSON.stringify(FULL_SURFACE));
  surface.report = { available: false, url: REPORT, grade: "", score: null, scored: 0, weakest: [], reason: "no_report_grade" };
  const { el } = await renderDashboard({ surface });
  const head = el("gradehead").innerHTML;
  assert.match(head, /nothing has been scored on it yet/);
  assert.doesNotMatch(head, /grade-letter/);
  assert.doesNotMatch(head, />F</);
});

test("no report on file says exactly that, with no link and no grade", async () => {
  const { el } = await renderDashboard({ surface: EMPTY_SURFACE });
  const head = el("gradehead").innerHTML;
  assert.match(head, /No visibility report on file yet\./);
  assert.doesNotMatch(head, /href=/);
  assert.doesNotMatch(head, /grade-letter/);
});

// ---------------------------------------------------------------------------
// The trend is a separate claim from the grade, and says only what is true
// ---------------------------------------------------------------------------

test("one scan or none draws no trend line and promises no scan", async () => {
  const { el } = await renderDashboard({ visibility: { ok: true, configured: true, points: [], delta: null } });
  const trend = el("gradetrend").innerHTML;
  assert.match(trend, /two or more scored scans are on file/);
  assert.doesNotMatch(trend, /<svg/);
  // The grade is unaffected by an empty scan history — that was the whole bug.
  assert.match(el("gradehead").innerHTML, /grade-letter good">B</);
});

test("two or more scans draw the real trend line", async () => {
  const { el } = await renderDashboard({
    visibility: {
      ok: true,
      configured: true,
      delta: 7,
      points: [
        { date: "2026-06-01T00:00:00Z", score: 76, grade: "C" },
        { date: "2026-07-01T00:00:00Z", score: 80, grade: "B-" },
        { date: "2026-08-01T00:00:00Z", score: 83, grade: "B" },
      ],
    },
  });
  const trend = el("gradetrend").innerHTML;
  assert.match(trend, /<svg/);
  assert.match(trend, /\+7 since start/);
  assert.match(trend, /Scored over time/);
});

test("an unconnected scan history is named as that, not as an absent business", async () => {
  const { el } = await renderDashboard({ visibility: { ok: true, configured: false, points: [] } });
  assert.match(el("gradetrend").innerHTML, /Scan history isn't connected yet/);
});

// ---------------------------------------------------------------------------
// Contracts the page depends on
// ---------------------------------------------------------------------------

test("the page no longer defaults anyone to the showcase client's business", () => {
  assert.doesNotMatch(html, /abprofessionaldetailing/i);
  assert.match(html, /var currentVisBusiness = ""/);
});

test("the site endpoint is same-origin, which the page's own CSP requires", () => {
  assert.match(html, /fetch\("\/api\/connect\/site"/);
  const config = JSON.parse(fs.readFileSync(LABS_VERCEL, "utf8"));
  const rewrite = config.rewrites.find((r) => r.source === "/api/connect/site");
  assert.ok(rewrite, "wss-ai.com must proxy /api/connect/site to the backend");
  assert.equal(rewrite.destination, "https://ghost-agency-backend.vercel.app/api/connect/site");
  const csp = config.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /connect-src 'self'/, "the same-origin fetch rule this rewrite exists for must stay");
});

test("every link the dashboard can render is https, tel or a real in-page target", () => {
  // <link rel=…> in the head names resources the browser fetches (manifest,
  // icons), not destinations a customer is sent to. Same-origin root-relative
  // is the rule for those; the clickable-link rule below is for real links.
  for (const [, href] of html.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*>/g)) {
    assert.match(href, /^\/[^/]/, `a head <link> must stay same-origin and root-relative: ${href}`);
  }
  const clickable = html.replace(/<link\b[^>]*>/g, "");
  const hrefs = [...clickable.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    const inPage = /^#[A-Za-z][\w:-]*$/.test(href);
    // mailto: joined the allowlist with the lead cards: the captured contact
    // email renders as a real mailto link, always through esc(). sms: joined
    // with Next steps — "Text Riley at …" is the same safe, device-handled
    // scheme family as tel:.
    assert.ok(inPage || /^(https:\/\/|tel:|sms:|mailto:'\+esc\(|'\+esc\()/.test(href), `unexpected href: ${href}`);
    if (inPage) {
      assert.match(html, new RegExp(`\\bid=["']${href.slice(1)}["']`), `missing in-page target: ${href}`);
    }
  }
  assert.match(html, /httpsOnly\(/, "rendered URLs must be scheme-checked in the browser too");
});
