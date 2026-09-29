"use strict";

// test/dashboard-one-door.test.js — one front door.
//
// The customer signs in ONCE (a scoped token) and the leads inbox is right
// there in the dashboard: there is no second app behind a second PIN, and there
// is no client-side path to the shared full-access token. WSS Connect remains
// available as one explicit PWA install link, never as a second data/login
// door. This runs the page's
// own script against a fake DOM and reads the markup it produced (the owner's
// standing rule: render it, don't grep for hopeful strings), plus a few static
// contracts about what the page must no longer contain or reach.
//
// Fails before 2026-08-08: the page shipped an "Open GetLeads ↗" link to
// connect.wss-labs.com (the second door) and a PIN_CIPHER/tokenFromPin backdoor
// that XOR-decrypted the shared full-access token from public JS. The sole
// allowed link now installs the phone PWA; all customer data stays here.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const DASHBOARD = path.resolve(__dirname, "../../labs-site/dashboard/index.html");
const LABS_VERCEL = path.resolve(__dirname, "../../labs-site/vercel.json");
const html = fs.readFileSync(DASHBOARD, "utf8");

const THREADS = [
  { id: 1, contact_name: "Alpha Lead", channel: "email", last_message_at: "2026-08-01T10:00:00Z", unread: true },
  { id: 2, contact_name: "Beta Lead", channel: "chat", last_message_at: "2026-07-01T10:00:00Z", unread: false },
];

async function renderDashboard({ threads = THREADS } = {}) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(script, "the dashboard must keep its inline script");

  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, innerHTML: "", textContent: "", value: "", style: {},
        addEventListener() {}, querySelectorAll() { return []; },
      });
    }
    return elements.get(id);
  };

  const answer = (body, status = 200) => Promise.resolve({
    ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
  });
  const calls = [];
  const sandbox = {
    console, setTimeout,
    fetch(url) {
      calls.push(String(url));
      const key = String(url).split("?")[0];
      if (key === "/api/connect/threads") return answer({ ok: true, threads });
      if (key === "/api/connect/site") return answer({ ok: true, businessName: "", clientId: "", site: { available: false, reason: "no_site_on_file" }, report: { available: false, reason: "no_report_on_file" } });
      if (key === "/api/connect/visibility") return answer({ ok: true, configured: false, points: [] });
      if (key === "/api/connect/edits") return answer({ ok: true, edits: [] });
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
    TextEncoder, TextDecoder,
  };
  sandbox.localStorage.setItem("wss_connect_token", "tenant-token-for-this-test");
  vm.runInNewContext(script[1], sandbox);
  for (let i = 0; i < 60; i += 1) await new Promise((r) => setImmediate(r));
  return { el: (id) => element(id), calls };
}

// ---- the folded-in inbox renders inline, from the tenant's own threads ------

test("the leads inbox renders the customer's own threads in the dashboard", async () => {
  const { el, calls } = await renderDashboard();
  assert.ok(calls.includes("/api/connect/threads"), "the page reads the tenant's threads");
  const list = el("leadlist").innerHTML;
  assert.match(list, /Alpha Lead/);
  assert.match(list, /Beta Lead/);
  assert.match(list, /data-thread="1"/);
  assert.match(list, /data-thread="2"/);
  assert.equal(String(el("unread").textContent), "1", "one unread thread is counted");
});

test("WSS Connect is exactly one install link, never a second inbox or login door", () => {
  const links = [...html.matchAll(/href="(https:\/\/connect\.wss-labs\.com\/?(?:[?#][^"]*)?)"/g)];
  assert.equal(links.length, 1, "the phone PWA must have exactly one HTTPS install link");
  const installUrl = new URL(links[0][1]);
  assert.equal(installUrl.origin, "https://connect.wss-labs.com");
  assert.equal(installUrl.pathname, "/", "the install link must not deep-link to another inbox or login");
  assert.equal(installUrl.search, "", "the install link must carry no customer data");
  assert.equal(installUrl.hash, "", "the install link must carry no auth fragment");
  assert.doesNotMatch(html, /Open GetLeads/);
  assert.doesNotMatch(html, /(?:fetch|location(?:\.href)?\s*=)\s*\(?["']https:\/\/connect\.wss-labs\.com/i,
    "the PWA origin must not become a client-side data or login route");
});

// ---- one auth model: the shared-PIN full-access backdoor is removed ---------

test("the public-JS shared-secret backdoor is gone", () => {
  assert.doesNotMatch(html, /PIN_CIPHER/, "the ciphertext of the shared token must not ship in public JS");
  assert.doesNotMatch(html, /PIN_VERIFY/);
  assert.doesNotMatch(html, /tokenFromPin/, "the client-side path to the full-access token must be gone");
  assert.doesNotMatch(html, /keystream/);
});

test("login no longer accepts a bare 6-digit PIN with no email", () => {
  // The only remaining PIN branch requires an email (the per-customer login).
  // There must be no `/^[0-9]{6}$/` fallback that mints a session without one.
  assert.doesNotMatch(html, /\/\^\[0-9\]\{6\}\$\//, "no bare-6-digit fallback may remain");
});

// ---- same-origin contracts for the newly-used endpoints ---------------------

test("messages and send are called same-origin and proxied by wss-ai.com", () => {
  assert.match(html, /fetch\("\/api\/connect\/messages/);
  assert.match(html, /fetch\("\/api\/connect\/send"/);
  const config = JSON.parse(fs.readFileSync(LABS_VERCEL, "utf8"));
  for (const p of ["/api/connect/messages", "/api/connect/send"]) {
    const rewrite = config.rewrites.find((r) => r.source === p);
    assert.ok(rewrite, `wss-ai.com must proxy ${p}`);
    assert.equal(rewrite.destination, `https://ghost-agency-backend.vercel.app${p}`);
  }
  const csp = config.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /connect-src 'self'/, "the same-origin fetch rule these rewrites exist for must stay");
});

test("every link the dashboard can render is https, tel or a real in-page target", () => {
  // <link rel=…> in the head names resources the browser fetches (manifest,
  // icons), not destinations a customer is sent to. They answer to a stricter
  // rule of their own — same-origin, root-relative — and are then taken out of
  // the scan so the clickable-link rule below stays about clickable links.
  for (const [, href] of html.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*>/g)) {
    assert.match(href, /^\/[^/]/, `a head <link> must stay same-origin and root-relative: ${href}`);
  }
  const clickable = html.replace(/<link\b[^>]*>/g, "");
  const hrefs = [...clickable.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  let installLinks = 0;
  for (const href of hrefs) {
    const inPage = /^#[A-Za-z][\w:-]*$/.test(href);
    // mailto: is on the allowlist for the lead cards: a captured contact email
    // renders as a real mailto link, always through esc(). sms: is on it for
    // Next steps — "Text Riley at …" is the same safe, device-handled family
    // as tel:.
    assert.ok(inPage || /^(tel:|sms:|mailto:'\+esc\(|'\+esc\()/.test(href) || /^https:\/\//.test(href), `unexpected href: ${href}`);
    if (inPage) {
      assert.match(html, new RegExp(`\\bid=["']${href.slice(1)}["']`), `missing in-page target: ${href}`);
    }
    if (/^https:\/\/connect\.wss-labs\.com\/?$/.test(href)) installLinks += 1;
  }
  assert.equal(installLinks, 1, "only the single WSS Connect install link may use its origin");
});
