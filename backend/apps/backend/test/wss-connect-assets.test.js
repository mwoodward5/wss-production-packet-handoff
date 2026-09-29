"use strict";

// test/wss-connect-assets.test.js — the WSS Connect closing-block assets:
// the funnel graphic markup and the prospect magic-link helper. Pure logic
// only; the rendered PNG and the live verify-link round trip are proven by
// lib/wss-connect-assets/render-funnel.js and the delivery checklist, not
// simulated here.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CONNECT_FUNNEL_HEIGHT,
  CONNECT_FUNNEL_URL,
  CONNECT_FUNNEL_WIDTH,
  PLATFORM_TILES,
  buildConnectFunnelPage,
  buildConnectFunnelSvg,
} = require("../lib/wss-connect-assets/funnel-html");
const {
  DASHBOARD_URL,
  deterministicProspectPin,
  prospectJobId,
  prospectMagicLink,
  prospectSiteSlug,
  prospectVisibilityBusiness,
} = require("../lib/wss-connect-assets/magic-link");
const { FORBIDDEN_HEX, PALETTE } = require("../lib/wss-email-design");
const { verifyDashboardLink } = require("../lib/dashboard-link");

const TEST_PROSPECT = Object.freeze({
  prospect_id: "wss-test-poor-john-s-plumbing-parkville",
  business_name: "Poor John's Plumbing",
  email: "contactus@poorjohns.com",
  current_website: "https://www.poorjohns.com/",
  preview_url: "https://wss-test-poor-john-s-plumbing-parkville.wss-ai.com/",
});

test("the funnel names all six owner-chosen platforms and no trademarked artwork", () => {
  const svg = buildConnectFunnelSvg();
  for (const tile of PLATFORM_TILES) {
    assert.ok(svg.includes(`<title>${tile.name}</title>`), `${tile.name} missing`);
    assert.ok(svg.includes(tile.fill), `${tile.name} tile colour missing`);
  }
  assert.equal(PLATFORM_TILES.length, 6);
  // Tiles are OUR drawing: initial-letter glyphs in text nodes, no embedded
  // platform artwork (no <image>, no data: URI).
  assert.ok(!/<image[\s>]/i.test(svg), "no raster/foreign artwork inside the funnel");
  assert.ok(!svg.includes("data:"), "no embedded data URIs");
});

test("the funnel is drawn from wss-email-design tokens and honours the design lock", () => {
  const svg = buildConnectFunnelSvg();
  assert.ok(svg.includes(PALETTE.accent), "flow lines and app tile use the brand accent");
  assert.ok(svg.includes(PALETTE.ink), "wordmark uses brand ink");
  for (const hex of FORBIDDEN_HEX) {
    assert.ok(!svg.toUpperCase().includes(hex), `forbidden hex ${hex} leaked into the funnel`);
  }
  assert.ok(svg.includes(`viewBox="0 0 ${CONNECT_FUNNEL_WIDTH} ${CONNECT_FUNNEL_HEIGHT}"`));
  assert.equal(CONNECT_FUNNEL_WIDTH, 560);
});

test("the funnel page renders on a transparent canvas from a first-party URL", () => {
  const page = buildConnectFunnelPage();
  assert.ok(page.includes("background: transparent"));
  assert.ok(CONNECT_FUNNEL_URL.startsWith("https://ghost.wss-ai.com/brand/"));
});

test("prospect identity derivations are stable and namespaced", () => {
  assert.equal(
    prospectJobId(TEST_PROSPECT),
    "prospect-wss-test-poor-john-s-plumbing-parkville",
  );
  // The tenant scope comes from the preview host label — the slug the Connect
  // surfaces key threads on — not from the business name.
  assert.equal(prospectSiteSlug(TEST_PROSPECT), "wss-test-poor-john-s-plumbing-parkville");
  // The visibility key is the bare domain of their real site.
  assert.equal(prospectVisibilityBusiness(TEST_PROSPECT), "poorjohns.com");
  // Without a website, fall back to the business name rather than inventing.
  assert.equal(
    prospectVisibilityBusiness({ business_name: "Poor John's Plumbing" }),
    "poor john's plumbing",
  );
});

test("the deterministic PIN is six digits, stable per prospect, and secret-bound", (t) => {
  const previous = process.env.CONNECT_APP_TOKEN;
  t.after(() => {
    if (previous === undefined) delete process.env.CONNECT_APP_TOKEN;
    else process.env.CONNECT_APP_TOKEN = previous;
  });
  process.env.CONNECT_APP_TOKEN = "test-secret-a";
  const first = deterministicProspectPin("prospect-x");
  assert.match(first, /^[0-9]{6}$/);
  assert.equal(deterministicProspectPin("prospect-x"), first, "same prospect, same PIN");
  process.env.CONNECT_APP_TOKEN = "test-secret-b";
  assert.notEqual(deterministicProspectPin("prospect-x"), first, "a rotated secret rotates the PIN");
});

test("no secret means no link — the honest dashboard fallback, never a dead token", async (t) => {
  const previousConnect = process.env.CONNECT_APP_TOKEN;
  const previousAdmin = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  t.after(() => {
    if (previousConnect === undefined) delete process.env.CONNECT_APP_TOKEN;
    else process.env.CONNECT_APP_TOKEN = previousConnect;
    if (previousAdmin === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = previousAdmin;
  });
  delete process.env.CONNECT_APP_TOKEN;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  const result = await prospectMagicLink(TEST_PROSPECT);
  assert.equal(result.ok, false);
  assert.equal(result.magicLink, "");
  assert.equal(result.dashboardUrl, DASHBOARD_URL);
  assert.equal(result.reason, "link_secret_missing");
});

test("an unprovisionable store refuses the link instead of minting a dead one", async (t) => {
  const previous = {
    CONNECT_APP_TOKEN: process.env.CONNECT_APP_TOKEN,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.CONNECT_APP_TOKEN = "test-secret-a";
  // Store unconfigured -> upsert reports dry_run -> the access row verify-link
  // depends on does NOT exist -> the helper must refuse the magic link.
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const result = await prospectMagicLink(TEST_PROSPECT);
  assert.equal(result.ok, false);
  assert.equal(result.magicLink, "");
  assert.match(String(result.reason), /^access_row_write_failed:/);
});

test("a minted token is the exact shape verify-link accepts", (t) => {
  const previous = process.env.CONNECT_APP_TOKEN;
  t.after(() => {
    if (previous === undefined) delete process.env.CONNECT_APP_TOKEN;
    else process.env.CONNECT_APP_TOKEN = previous;
  });
  process.env.CONNECT_APP_TOKEN = "test-secret-a";
  const { signDashboardLink } = require("../lib/dashboard-link");
  const token = signDashboardLink(prospectJobId(TEST_PROSPECT), 30);
  const verdict = verifyDashboardLink(token);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.jobId, "prospect-wss-test-poor-john-s-plumbing-parkville");
});
