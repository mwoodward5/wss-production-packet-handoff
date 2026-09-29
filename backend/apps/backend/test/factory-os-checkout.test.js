"use strict";

// ---------------------------------------------------------------------------
// test/factory-os-checkout.test.js — THE BILLING LOOP'S MISSING MIDDLE.
//
// On 2026-09-18 a valid signed checkout link redirected to
// https://api.local.wss-ai.test:5443/factory-os?checkout=contact&job=... —
// an internal-only host, serving a route (/factory-os) that DID NOT EXIST on
// either runtime. Click -> 404 -> no money. These tests hold the three fixes
// shut, and they are written against the SHIPPED artifacts (rendered page
// bytes, executed provisioning writes, the rewrite tables actually loaded by
// the local server and Vercel), never against the intention:
//
//   A. THE PUBLIC BASE. Minted links and redirects must be clickable from
//      the open internet; a local-only configured base is replaced by the
//      tunnelled public host (lib/registry.js publicLinkBase).
//   B. THE PAGE. /factory-os must render: plan + price the prospect was
//      quoted, a Stripe card button ONLY when Stripe is configured, and an
//      honest "we'll invoice you" contact path when it is not.
//   C. THE PROVISIONING. An owner-marked-paid (invoiced) customer must get
//      the same dashboard access row + welcome email the Stripe webhook
//      path issues (lib/fulfillment.js provisionInvoicedCheckout).
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { afterEach, test } = require("node:test");

const { createFactoryOsHandler } = require("../api/factory-os");
const {
  buildCheckoutLink,
  verifyCheckoutLink,
  CHECKOUT_SECRET_ENV_NAME,
} = require("../lib/checkout-links");
const {
  DEFAULT_PUBLIC_BASE_URL,
  isLocalOnlyOrigin,
  publicBaseUrl,
  publicConfig,
  publicLinkBase,
  PUBLIC_BASE_URL_ENV_NAME,
} = require("../lib/registry");

const SECRET = "factory-os-test-secret";
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  global.fetch = originalFetch;
});

function visibleText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&rsquo;/gi, "'")
    .replace(/&#36;/g, "$")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function fakeRes() {
  const out = { statusCode: 200, headers: {}, body: "" };
  out.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
  out.end = (chunk) => { if (chunk) out.body += chunk; };
  return out;
}

const PAGE_OVERRIDES = {
  providerStatus: () => ({ stripe: { configured: false } }),
  publicConfig: () => ({
    apiUrl: "https://ghost.wss-ai.com",
    ownerEmail: "owner@example.com",
    supportEmail: "support@example.com",
  }),
  select: async () => ({ ok: true, data: [{ business_name: "Acme Roofing" }] }),
  resolveRileyLine: () => ({ phone: null, display: "", telHref: "", source: null, reason: "unset" }),
};

async function renderPage(query = {}, overrides = {}) {
  const events = [];
  const handler = createFactoryOsHandler({
    ...PAGE_OVERRIDES,
    recordEvent: async (name, payload) => { events.push({ name, payload }); },
    ...overrides,
  });
  const res = fakeRes();
  await handler({ method: "GET", query }, res);
  return { res, html: res.body, events };
}

// ===========================================================================
// A. THE PUBLIC BASE A LINK IS BUILT ON
// ===========================================================================

test("the local-only bases this compose stack actually configures are recognized", () => {
  assert.equal(isLocalOnlyOrigin("https://api.local.wss-ai.test:5443"), true);
  assert.equal(isLocalOnlyOrigin("http://localhost:3000"), true);
  assert.equal(isLocalOnlyOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isLocalOnlyOrigin("https://supabase.local.wss-ai.test:54321"), true);
  assert.equal(isLocalOnlyOrigin("http://192.168.1.10"), true);
  assert.equal(isLocalOnlyOrigin("not a url"), true);
  // Public values pass through untouched.
  assert.equal(isLocalOnlyOrigin("https://ghost.wss-ai.com"), false);
  assert.equal(isLocalOnlyOrigin("https://woodward-ghost-agency-vercel.vercel.app"), false);
});

test("publicLinkBase swaps a local-only configured base for the public one", () => {
  assert.equal(publicLinkBase("https://api.local.wss-ai.test:5443"), DEFAULT_PUBLIC_BASE_URL);
  assert.equal(publicLinkBase("http://localhost:3000"), DEFAULT_PUBLIC_BASE_URL);
  assert.equal(publicLinkBase(""), DEFAULT_PUBLIC_BASE_URL);
  assert.equal(publicLinkBase("https://deck.example.com/"), "https://deck.example.com");
  assert.equal(DEFAULT_PUBLIC_BASE_URL, "https://ghost.wss-ai.com");
});

test("GHOST_AGENCY_PUBLIC_BASE_URL overrides the fallback; a local-only override does not", () => {
  process.env[PUBLIC_BASE_URL_ENV_NAME] = "https://pay.example.com";
  assert.equal(publicBaseUrl(), "https://pay.example.com");
  process.env[PUBLIC_BASE_URL_ENV_NAME] = "http://localhost:9999";
  assert.equal(publicBaseUrl(), DEFAULT_PUBLIC_BASE_URL);
});

test("publicConfig never hands a local-only base to a link builder", () => {
  // Exactly the values the local compose stack ships (2026-09-18).
  process.env.PUBLIC_APP_URL = "https://api.local.wss-ai.test:5443";
  process.env.GHOST_AGENCY_API_URL = "http://localhost:3000";
  const config = publicConfig();
  assert.equal(config.publicAppUrl, "https://ghost.wss-ai.com");
  assert.equal(config.apiUrl, "https://ghost.wss-ai.com");
  // And a genuinely public configuration still wins.
  process.env.PUBLIC_APP_URL = "https://deck.example.com";
  process.env.GHOST_AGENCY_API_URL = "https://api.example.com";
  const publicOverride = publicConfig();
  assert.equal(publicOverride.publicAppUrl, "https://deck.example.com");
  assert.equal(publicOverride.apiUrl, "https://api.example.com");
});

test("a checkout link minted under local-only env is still publicly clickable and verifies", () => {
  process.env[CHECKOUT_SECRET_ENV_NAME] = SECRET;
  process.env.GHOST_AGENCY_API_URL = "http://localhost:3000";
  const url = new URL(buildCheckoutLink({
    prospect: { prospect_id: "acme-roofing-ventura", business_name: "Acme Roofing" },
    job: { id: "mirror-acme-roofing-ventura" },
  }));
  // BEFORE THE FIX this minted http://localhost:3000/api/checkout-link?... —
  // a link that 401s (or DNS-fails) for every prospect off-machine.
  assert.equal(url.origin, "https://ghost.wss-ai.com");
  const check = verifyCheckoutLink(url.searchParams.get("token"), url.searchParams.get("sig"));
  assert.equal(check.ok, true, JSON.stringify(check));
});

// ===========================================================================
// B. THE PAGE — plan + honest payment state, rendered server-side
// ===========================================================================

test("contact state renders the plan, the quoted price, and an invoice contact path to the owner", async () => {
  const { html, events } = await renderPage({ checkout: "contact", job: "mirror-acme" });
  assert.equal(html.includes("Acme Roofing"), true, "the business name from the job row is missing");
  const text = visibleText(html);
  assert.match(text, /\$149/);
  assert.match(text, /\$500 setup fee/);
  assert.doesNotMatch(text, /\$199|\$499/);
  assert.match(text, /invoice you/i);
  const mailto = html.match(/href="mailto:([^"?]+)/);
  assert.ok(mailto, "no mailto contact path rendered");
  assert.equal(mailto[1], "owner@example.com");
  // The view is recorded so the owner can see demand even without Stripe.
  assert.equal(events[0]?.name, "factory_os_checkout_view");
  assert.equal(events[0]?.payload.state, "contact");
  assert.equal(events[0]?.payload.stripeReady, false);
});

test("with Stripe unconfigured there is NO card form, NO Stripe script — nothing that looks broken", async () => {
  const { html } = await renderPage({ checkout: "contact", job: "mirror-acme" });
  assert.doesNotMatch(html, /js\.stripe\.com|checkout\.stripe\.com|<form|<input|card number/i);
  assert.doesNotMatch(html, /id="wss-pay"/);
});

test("with Stripe configured the card button mints a session through the server-side route", async () => {
  const { html } = await renderPage(
    { checkout: "contact", job: "mirror-acme" },
    { providerStatus: () => ({ stripe: { configured: true } }) },
  );
  assert.match(html, /id="wss-pay"/);
  assert.match(html, /\/api\/checkout/);
  // No card fields ever live on this page — Stripe hosts the payment.
  assert.doesNotMatch(html, /<form|<input/i);
});

test("success state tells the buyer what actually happens next (webhook-side provisioning)", async () => {
  const { html } = await renderPage({ checkout: "success", job: "mirror-acme" });
  const text = visibleText(html);
  assert.match(text, /payment received/i);
  assert.match(text, /magic link/i);
  assert.match(text, /PIN/i);
  assert.match(html, /mailto:owner@example.com/);
});

test("cancelled state says no charge was made and keeps the contact path", async () => {
  const { html } = await renderPage({ checkout: "cancelled", job: "mirror-acme" });
  const text = visibleText(html);
  assert.match(text, /no charge/i);
  assert.match(html, /mailto:owner@example.com/);
});

test("the bare landing state renders the plan for a visitor with no query at all", async () => {
  const { res, html } = await renderPage({});
  assert.equal(res.statusCode, 200);
  assert.match(visibleText(html), /\$149/);
  assert.match(html, /mailto:owner@example.com/);
});

test("hostile job ids and business names are escaped, never interpolated raw", async () => {
  const { html } = await renderPage(
    { checkout: "contact", job: '"><script>alert(1)</script>' },
    { select: async () => ({ ok: true, data: [{ business_name: "<script>alert(2)</script>" }] }) },
  );
  assert.doesNotMatch(html, /<script>alert\(/);
  assert.match(html, /&lt;script&gt;/);
});

test("both runtimes actually route /factory-os — the local server AND Vercel", () => {
  const repoRoot = path.join(__dirname, "..", "..", "..");
  // Candidate locations for the local-server shim, in order: this repo
  // checkout; the backend container's /opt mount (reading THAT validates the
  // rewrite table the running server actually loaded); and this desktop's
  // runtime tree for partial checkouts that omit infra/.
  const candidates = [
    path.join(repoRoot, "infra", "backend", "local-server.cjs"),
    "/opt/local-server.cjs",
    "C:\\ghx-localfirst\\infra\\backend\\local-server.cjs",
  ];
  const localServerPath = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(localServerPath, `no local-server.cjs found in: ${candidates.join(", ")}`);
  const localServer = fs.readFileSync(localServerPath, "utf8");
  assert.match(localServer, /\["\/factory-os",\s*"\/api\/factory-os"\]/);
  const vercelJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.deepEqual(
    (vercelJson.rewrites || []).find((r) => r.source === "/factory-os"),
    { source: "/factory-os", destination: "/api/factory-os" },
  );
});

// ===========================================================================
// C. PROVISIONING THE INVOICED CUSTOMER — same rows + welcome email as the
//    Stripe path, driven by the owner's confirmation instead of a webhook.
// ===========================================================================

const fulfillmentPath = require.resolve("../lib/fulfillment");
const emailPath = require.resolve("../lib/email");
const storePath = require.resolve("../lib/store");

function mockedModule(modulePath, exports_) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: exports_ };
}

async function withProvisionHarness(run) {
  const originals = new Map([fulfillmentPath, emailPath, storePath].map((p) => [p, require.cache[p]]));
  const previousFetch = global.fetch;
  const state = { upserts: [], events: [], activationInputs: [], fetchCalls: [], selectResult: { ok: false, data: [] } };

  Object.assign(process.env, {
    CONNECT_APP_TOKEN: "provision-test-secret",
    RESEND_API_KEY: "re_provision_test",
    GHOST_AGENCY_RESEND_FROM: "WSS Labs <hello@wss-ai.com>",
  });
  delete process.env.STRIPE_SECRET_KEY;

  mockedModule(emailPath, {
    buildActivationEmail: (input) => {
      state.activationInputs.push(input);
      return {
        subject: "Your dashboard",
        text: `PIN ${input.pin} ${input.magicLink}`,
        html: `<p>${input.pin} ${input.magicLink}</p>`,
      };
    },
  });
  mockedModule(storePath, {
    insertRow: async () => ({ mode: "live_write", row: [{}] }),
    upsertRow: async (table, row) => {
      state.upserts.push({ table, row });
      return { mode: "live_upsert", row: [row] };
    },
    select: async () => state.selectResult,
    recordEvent: async (name, payload) => { state.events.push({ name, payload }); },
  });
  global.fetch = async (url, init) => {
    state.fetchCalls.push({ url: String(url), init });
    return { ok: true, json: async () => ({ id: "email_123" }) };
  };

  delete require.cache[fulfillmentPath];
  try {
    const { provisionInvoicedCheckout } = require("../lib/fulfillment");
    await run(state, provisionInvoicedCheckout);
  } finally {
    for (const [p, cached] of originals) {
      if (cached) require.cache[p] = cached;
      else delete require.cache[p];
    }
    global.fetch = previousFetch;
  }
}

function rowsFor(state, table) {
  return state.upserts.filter((u) => u.table === table).map((u) => u.row);
}

test("provisionInvoicedCheckout writes the job, entitlement, and dashboard access rows", async () => {
  await withProvisionHarness(async (state, provision) => {
    const out = await provision({
      jobId: "mirror-acme-roofing-ventura",
      customerEmail: "Owner@AcmeRoofing.com ",
      businessName: "Acme Roofing",
      dryRun: true,
    });
    assert.equal(out.mode, "invoiced_checkout_provisioned");
    assert.equal(out.customerEmail, "owner@acmeroofing.com");

    const job = rowsFor(state, "ghost_agency_jobs")[0];
    assert.equal(job.job_id, "mirror-acme-roofing-ventura");
    assert.equal(job.status, "invoiced_checkout_completed");

    const entitlement = rowsFor(state, "ghost_agency_entitlements")[0];
    assert.equal(entitlement.product, "local-growth-website-plan");
    assert.equal(entitlement.entitlement, "local_website_launch_job");
    assert.equal(entitlement.status, "active_pending_delivery");

    const access = rowsFor(state, "ghost_agency_dashboard_access")[0];
    assert.equal(access.job_id, "mirror-acme-roofing-ventura");
    assert.equal(access.owner_email, "owner@acmeroofing.com");
    // The row the customer types their PIN against must hash that PIN.
    assert.match(out.dashboardAccess.pin, /^\d{6}$/);
    assert.equal(
      access.pin_hash,
      createHash("sha256").update(out.dashboardAccess.pin).digest("hex"),
    );
    assert.match(out.dashboardAccess.magicLink, /^https:\/\/wss-ai\.com\/dashboard#t=/);

    // dryRun means NO email left the building.
    assert.equal(state.fetchCalls.length, 0);
    assert.equal(out.email.mode, "skipped_dry_run");
    assert.equal(state.events[state.events.length - 1].name, "ghost_agency_manual_provision");
  });
});

test("the issued PIN is deterministic per job — re-provisioning never rotates it", async () => {
  await withProvisionHarness(async (state, provision) => {
    const input = { jobId: "mirror-stable", customerEmail: "a@b.co", businessName: "Stable Co", dryRun: true };
    const first = await provision(input);
    const second = await provision(input);
    assert.equal(second.dashboardAccess.pin, first.dashboardAccess.pin);
  });
});

test("provisionInvoicedCheckout sends the welcome email through Resend, idempotent per job", async () => {
  await withProvisionHarness(async (state, provision) => {
    const out = await provision({
      jobId: "mirror-emailed",
      customerEmail: "buyer@example.com",
      businessName: "Emailed Co",
    });
    assert.equal(out.email.mode, "sent");
    assert.equal(state.fetchCalls.length, 1);
    const call = state.fetchCalls[0];
    assert.equal(call.url, "https://api.resend.com/emails");
    assert.equal(call.init.headers["Idempotency-Key"], "ghost-activation/manual-mirror-emailed");
    const body = JSON.parse(call.init.body);
    assert.equal(body.to, "buyer@example.com");
    // The email carries the credentials the access row accepts.
    assert.ok(body.text.includes(out.dashboardAccess.pin), "welcome email lost the PIN");
    assert.ok(body.html.includes(out.dashboardAccess.magicLink), "welcome email lost the magic link");
  });
});

test("bad input is refused by name, before any write", async () => {
  await withProvisionHarness(async (state, provision) => {
    await assert.rejects(() => provision({ customerEmail: "a@b.co" }), (e) => e.code === "provision_job_id_missing");
    await assert.rejects(
      () => provision({ jobId: "j", customerEmail: "not-an-email" }),
      (e) => e.code === "provision_customer_email_invalid",
    );
    assert.equal(state.upserts.length, 0);
  });
});

// ===========================================================================
// THE ADMIN DOOR — owner-only, and it says which input it refuses
// ===========================================================================

test("the provision route refuses anonymous callers with 401", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "admin-test-token";
  const handler = require("../api/admin/provision-checkout");
  const res = fakeRes();
  await handler({ method: "POST", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
});

test("the provision route rejects malformed bodies with 400 and the named error", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "admin-test-token";
  const handler = require("../api/admin/provision-checkout");
  const res = fakeRes();
  await handler({
    method: "POST",
    headers: { authorization: "Bearer admin-test-token" },
    body: { customer_email: "owner@example.com" }, // no job_id
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, "provision_job_id_missing");
});
