"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");

process.env.GHOST_AGENCY_REPORT_LINK_SECRET = "reveal-test-secret";
process.env.GHOST_AGENCY_API_URL = "https://ghost.wss-ai.com";
const { buildRevealLink, verifyRevealLink } = require("../lib/reveal-links");

test("reveal link round-trips and carries the preview target", () => {
  const link = buildRevealLink({ prospect_id: "p1", business_name: "Acme Roofing", industry: "roofing", preview_url: "https://siteforge-app-seven.vercel.app/try/acme/" });
  assert.match(link, /\/api\/reveal\?token=.+&sig=.+/);
  const u = new URL(link);
  const v = verifyRevealLink(u.searchParams.get("token"), u.searchParams.get("sig"));
  assert.equal(v.ok, true);
  assert.equal(v.payload.preview_url, "https://siteforge-app-seven.vercel.app/try/acme/");
  assert.equal(v.payload.prospect_id, "p1");
});

test("a tampered signature is rejected", () => {
  const u = new URL(buildRevealLink({ prospect_id: "p2", preview_url: "https://x.test/try/" }));
  assert.equal(verifyRevealLink(u.searchParams.get("token"), "forged").ok, false);
});

test("an expired link is rejected", () => {
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: Date.now() - 1000, prospect_id: "p3", preview_url: "https://x.test/" }), "utf8").toString("base64url");
  const { createHmac } = require("node:crypto");
  const sig = createHmac("sha256", "reveal-test-secret").update(`reveal:${payload}`).digest("base64url");
  assert.equal(verifyRevealLink(payload, sig).reason, "expired");
});
