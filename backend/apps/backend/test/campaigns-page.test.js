"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PAGE = require("../lib/campaigns-page-final");
const GALLERY_PAGE = require("../lib/gallery-page");
const handler = require("../api/admin/campaigns");

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload; },
  };
}

test("Vercel serves current Outreach review at /campaigns", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(config.rewrites?.some((r) => r.source === "/campaigns" && r.destination === "/api/admin/campaigns"));
});

test("Outreach shell is GET-only, uncached, and uses the admin-gated line API", async () => {
  const res = fakeRes();
  await handler({ method: "GET", url: "/campaigns", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.match(res.headers["Content-Type"], /text\/html/);
  assert.equal(res.body, PAGE);
  assert.match(PAGE, /\/api\/admin\/line/);
  assert.match(PAGE, /x-admin-token/);
  assert.match(PAGE, /wsl_admin_token/);
  assert.doesNotMatch(PAGE, /process\.env/);

  const post = fakeRes();
  await handler({ method: "POST", url: "/campaigns", headers: {} }, post);
  assert.equal(post.statusCode, 405);
});

test("Outreach shows only current building or reviewable work, not obsolete history", () => {
  assert.match(PAGE, /Outreach/);
  assert.match(PAGE, /function olderBatches\(\)\{return \[\];\}/);
  assert.doesNotMatch(PAGE, />Your campaigns</i);
  assert.match(PAGE, /function buildingBatches\(\)/);
  assert.match(PAGE, /function readyBatches\(\)/);
});

test("ready-made research gets a human campaign name in Outreach", () => {
  assert.match(PAGE, /Local Growth Sprint/);
  assert.doesNotMatch(PAGE, />Researched leads</i);
});

test("Outreach retains the proven armed two-press approval/send window", () => {
  assert.match(PAGE, /press the button again within 20 seconds/);
  assert.match(PAGE, /20000/);
  assert.match(PAGE, /Confirmation window expired — nothing was approved and nothing was sent/);
  assert.match(PAGE, /action:"approve",batchId:id,typedBatchId:id/);
  assert.match(PAGE, /action:"send",batchId:id/);
  assert.match(PAGE, /remaining/);
  assert.match(PAGE, /the server made no progress this pass/);
  assert.match(PAGE, /Server totals:/);
});

test("Outreach still promises owner-only proof delivery where the existing lane says so", () => {
  assert.match(PAGE, /Every email goes to your own inbox\. No business owner can be reached from this page\./);
  assert.match(PAGE, /proof emails to /);
  assert.match(PAGE, /nothing goes to a customer/i);
});

test("every screenshot socket remains branded until a proven image loads", () => {
  assert.match(PAGE, /thumb-empty/);
  assert.match(PAGE, /blockLabel\.textContent="WSS preview"/);
  assert.match(PAGE, /data-preview-state","fallback/);
  assert.match(PAGE, /\.thumb img\{[^}]*visibility:hidden/);
  assert.match(PAGE, /\.thumb\[data-preview-state="image"\] img\{visibility:visible\}/);
  assert.match(PAGE, /naturalWidth>=50&&img\.naturalHeight>=50/);
  assert.match(PAGE, /addEventListener\("error",showFallback\)/);
});

test("board state colors remain green for live/ready and violet for sent", () => {
  assert.match(PAGE, /\.camp-live\{[^}]*color:var\(--pulse\)/);
  assert.match(PAGE, /\.site-state\{[^}]*color:var\(--pulse\)/);
  assert.match(PAGE, /\.site-state\.sent\{[^}]*rgba\(124,108,246/);
});

test("phone layout wraps instead of clipping controls", () => {
  assert.match(PAGE, /@media\(max-width:640px\)\{[\s\S]*?\.masthead\{flex-wrap:wrap/);
  assert.match(PAGE, /@media\(max-width:640px\)\{[\s\S]*?\.masthead-note\{margin-left:0;width:100%\}/);
});

test("per-site refusal codes are translated consistently with the gallery", () => {
  assert.match(PAGE, /function plainReason\(code\)/);
  assert.match(PAGE, /the before-and-after pictures for the email were never taken/);
  assert.match(PAGE, /this address asked not to be emailed/);
  const { PLAIN_REFUSAL, plainRefusal } = require("../lib/send-refusals");
  for (const [code, sentence] of Object.entries(PLAIN_REFUSAL)) {
    assert.ok(PAGE.includes(sentence), `Outreach missing sentence for ${code}`);
    assert.ok(GALLERY_PAGE.includes(sentence), `gallery missing sentence for ${code}`);
  }
  assert.equal(plainRefusal("not_a_real_code"), "");
});
