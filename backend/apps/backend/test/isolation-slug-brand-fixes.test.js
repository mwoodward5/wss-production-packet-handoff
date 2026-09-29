"use strict";

// test/isolation-slug-brand-fixes.test.js — three production kills from the
// 2026-08-31 batches, locked at unit level with zero network.
//
//   1. client_isolation_violation (422) at /facts: stamp_agreement — a slug
//      stamped BEFORE phone became available/known ("", name) met a rebuild
//      of the SAME business carrying the phone and was refused forever
//      (wss-test-zins-plumbing-cincinnati, wss-test-bellagio-phoenix). The
//      fix widens the stamp additively when the business name agrees; every
//      genuine disagreement still fails exactly as before.
//   2. slug_conflict (409) — slugFor folds name+city into one label, so a
//      recycled prospect (wss-test-air-pro-albuquerque, bound_to "air pro
//      inc.") died on the claim. The lane now dedupes deterministically with
//      a prospect-id digest suffix and retries twice.
//   3. brand_asset_rejected (422) — both colour-provenance sources denylisted
//      killed a build whose site_accent/accent_fallback came from its own
//      (redirected, denylisted-host) page. The engine now drops the colour
//      and continues; logo/accent_source denylist stays a hard fail.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  guardBuildStart,
  readStamp,
  ClientIsolationError,
} = require("../lib/mirror-engine/client-isolation");
const {
  resolveBrandAssets,
} = require("../lib/mirror-engine/brand-assets");
const {
  mirrorWithSlugConflictRetry,
  isSlugConflictResult,
  dedupedSlugFor,
} = require("../lib/mirror-lane-build");

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wss-isolation-fix-"));
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });
  return root;
}

// ---------------------------------------------------------------------------
// 1. stamp_agreement — the stamp-predates-the-phone widening
// ---------------------------------------------------------------------------

test("a rebuild of the SAME business may present a phone the empty-phone stamp never had", (t) => {
  const root = tempRoot(t);
  const slug = "wss-test-zins-plumbing-cincinnati";
  const facts = { business_name: "Zins Plumbing", city: "Cincinnati", state: "OH" };

  // First build: phone is optional since 2026-08-01, so the stamp carries none.
  const first = guardBuildStart({ slug, facts, root });
  assert.equal(first.ok, true);
  assert.equal(readStamp(slug, root).phoneDigits, "");

  // The enriched rebuild that production killed — same business, phone present.
  const second = guardBuildStart({
    slug,
    facts: { ...facts, phone: "(513) 681-2501" },
    root,
  });
  assert.equal(second.ok, true);
  assert.ok(second.checks.some((c) => c.check === "stamp_widened_phone" && c.ok === true));

  // The widened phone is pinned on disk for every build after.
  const widened = readStamp(slug, root);
  assert.equal(widened.phoneDigits, "5136812501");
  assert.ok(widened.phoneWidenedAt);
});

test("a stamp that already carries a phone still refuses a different number", (t) => {
  const root = tempRoot(t);
  const slug = "wss-test-bellagio-phoenix";
  const facts = { business_name: "BELLAGIO", city: "Phoenix", state: "AZ", phone: "(602) 975-5013" };

  assert.equal(guardBuildStart({ slug, facts, root }).ok, true);

  assert.throws(
    () => guardBuildStart({ slug, facts: { ...facts, phone: "(520) 555-0144" }, root }),
    (e) => e instanceof ClientIsolationError
      && e.failures.some((f) => f.check === "stamp_agreement" && f.field === "phone"),
  );
  // The stamp is untouched by the refused attempt.
  assert.equal(readStamp(slug, root).phoneDigits, "6029755013");
});

test("a different business cannot use the widening door to take an empty-phone slug", (t) => {
  const root = tempRoot(t);
  const slug = "wss-test-bellagio-phoenix";
  assert.equal(guardBuildStart({
    slug,
    facts: { business_name: "BELLAGIO", city: "Phoenix", state: "AZ" },
    root,
  }).ok, true);

  // Foreign packet: right slug shape, wrong business, any phone.
  assert.throws(
    () => guardBuildStart({
      slug,
      facts: { business_name: "Desert Rose Med Spa", city: "Phoenix", state: "AZ", phone: "(602) 975-5013" },
      root,
    }),
    (e) => e instanceof ClientIsolationError
      && e.failures.some((f) => f.check === "stamp_agreement" && f.field === "businessName"),
  );
  assert.equal(readStamp(slug, root).phoneDigits, "");
});

test("a phoneless rebuild of a phone-stamped client still fails closed", (t) => {
  const root = tempRoot(t);
  const slug = "wss-test-air-pro-albuquerque";
  assert.equal(guardBuildStart({
    slug,
    facts: { business_name: "Air Pro Inc.", city: "Albuquerque", state: "NM", phone: "(505) 555-0128" },
    root,
  }).ok, true);

  assert.throws(
    () => guardBuildStart({
      slug,
      facts: { business_name: "Air Pro Inc.", city: "Albuquerque", state: "NM" },
      root,
    }),
    (e) => e instanceof ClientIsolationError
      && e.failures.some((f) => f.check === "stamp_agreement" && f.field === "phone"),
  );
});

// ---------------------------------------------------------------------------
// 2. slug_conflict — deterministic prospect-id dedupe retry
// ---------------------------------------------------------------------------

const PROSPECT_ID = "lm-c09420abd37d76d9da59f8eb8a8c53e5d3280ff7";
const BASE_SLUG = "wss-test-air-pro-albuquerque";

function slugConflict(slug) {
  return {
    ok: false,
    status: 409,
    body: { ok: false, error: "slug_conflict", detail: [{ slug, bound_to: "air pro inc." }] },
  };
}

function buildOk(slug) {
  return {
    ok: true,
    status: 200,
    body: { ok: true, revealable: true, slug, preview_url: `https://${slug}.wss-ai.com/` },
  };
}

function laneArgs(run) {
  return {
    run,
    readFleet: async () => ({ ok: true, identities: [] }),
    recordFleet: async () => ({ ok: true }),
    claimRetry: async () => ({ ok: false, claimed: false }),
    request: { slug: BASE_SLUG, facts: { business_name: "Air Pro Inc.", city: "Albuquerque", state: "NM" } },
    prospectId: PROSPECT_ID,
    dryRun: false,
  };
}

test("a 409 slug_conflict is deduped with a prospect-id suffix and the build succeeds", async () => {
  const seen = [];
  const run = async (request) => {
    seen.push(request.slug);
    return seen.length === 1 ? slugConflict(request.slug) : buildOk(request.slug);
  };

  const args = laneArgs(run);
  const res = await mirrorWithSlugConflictRetry(args);
  assert.equal(res.ok, true, JSON.stringify(res.body || res));
  assert.equal(seen.length, 2);
  assert.equal(seen[0], BASE_SLUG);
  assert.equal(seen[1], dedupedSlugFor(BASE_SLUG, PROSPECT_ID, 1));
  assert.match(seen[1], new RegExp(`^${BASE_SLUG.slice(0, 44)}-[0-9a-f]{6}$`));
  // The deduped label stays inside the 51-char cert headroom slugFor plans for.
  assert.ok(seen[1].length <= 51);
  // The caller's request object was not mutated into the new slug.
  assert.equal(args.request.slug, BASE_SLUG);
});

test("the dedupe is deterministic: a rebuild re-derives the same deduped label", () => {
  assert.equal(dedupedSlugFor(BASE_SLUG, PROSPECT_ID, 1), dedupedSlugFor(BASE_SLUG, PROSPECT_ID, 1));
  assert.notEqual(dedupedSlugFor(BASE_SLUG, PROSPECT_ID, 2), dedupedSlugFor(BASE_SLUG, PROSPECT_ID, 1));
  // A different prospect colliding on the same label gets a different suffix.
  assert.notEqual(dedupedSlugFor(BASE_SLUG, "lm-other-prospect", 1), dedupedSlugFor(BASE_SLUG, PROSPECT_ID, 1));
});

test("a slug that still conflicts after both retries keeps its failure", async () => {
  const seen = [];
  const run = async (request) => {
    seen.push(request.slug);
    return slugConflict(request.slug);
  };

  const res = await mirrorWithSlugConflictRetry(laneArgs(run));
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "slug_conflict");
  assert.equal(seen.length, 3, "one original attempt plus two dedupe retries");
  assert.deepEqual(seen, [
    BASE_SLUG,
    dedupedSlugFor(BASE_SLUG, PROSPECT_ID, 1),
    dedupedSlugFor(BASE_SLUG, PROSPECT_ID, 2),
  ]);
});

test("a 409 without a prospect id is returned untouched (no derivation possible)", async () => {
  const seen = [];
  const run = async (request) => { seen.push(request.slug); return slugConflict(request.slug); };

  const args = laneArgs(run);
  delete args.prospectId;
  const res = await mirrorWithSlugConflictRetry(args);
  assert.equal(res.status, 409);
  assert.equal(seen.length, 1);
});

test("non-conflict refusals are never retried", async () => {
  const seen = [];
  const run = async (request) => {
    seen.push(request.slug);
    return { ok: false, status: 422, body: { ok: false, error: "brand_asset_rejected", detail: [] } };
  };

  const res = await mirrorWithSlugConflictRetry(laneArgs(run));
  assert.equal(res.status, 422);
  assert.equal(seen.length, 1);
});

test("isSlugConflictResult reads both the HTTP-wrapped and direct body shapes", () => {
  assert.equal(isSlugConflictResult(slugConflict(BASE_SLUG)), true);
  assert.equal(isSlugConflictResult({ body: { ok: false, error: "slug_conflict" } }), true);
  assert.equal(isSlugConflictResult({ status: 409, body: { ok: true } }), false);
  assert.equal(isSlugConflictResult({ status: 422, body: { ok: false, error: "brand_asset_rejected" } }), false);
  assert.equal(isSlugConflictResult(null), false);
});

// ---------------------------------------------------------------------------
// 3. brand_asset_rejected — colour-source denylist abstains, identity stays hard
// ---------------------------------------------------------------------------

const DENYLISTED_PAGE = "https://www.facebook.com/phoenixmagazinelux";

test("denylisted accent_fallback_source / site_accent_source drop the colour and the build continues", async () => {
  const out = await resolveBrandAssets({
    accent_fallback: "#0C449A",
    accent_fallback_source: DENYLISTED_PAGE,
    site_accent: "#0C449A",
    site_accent_source: DENYLISTED_PAGE,
  });
  assert.equal(out.ok, true, "the fallback path must never 422");
  assert.equal(out.accent, null, "no colour ships without provable provenance");
  assert.ok(Array.isArray(out.dropped_colour_sources));
  assert.equal(out.dropped_colour_sources.length, 2);
  for (const drop of out.dropped_colour_sources) {
    assert.equal(drop.reason, "third_party_mark_denylisted_colour_dropped");
    assert.ok(drop.path === "/brand/accent_fallback_source" || drop.path === "/brand/site_accent_source");
  }
});

test("a caller-supplied accent survives while the denylisted fallback is dropped", async () => {
  const out = await resolveBrandAssets({
    accent: "#0C449A",
    accent_fallback: "#E67E22",
    accent_fallback_source: DENYLISTED_PAGE,
  });
  assert.equal(out.ok, true);
  assert.equal(out.accent, "#0C449A");
  assert.equal(out.accent_origin, "caller_supplied");
  assert.equal(out.dropped_colour_sources.length, 1);
  assert.equal(out.dropped_colour_sources[0].path, "/brand/accent_fallback_source");
});

test("a denylisted accent_source is STILL a hard fail (provenance law unchanged)", async () => {
  const out = await resolveBrandAssets({
    accent: "#112233",
    accent_source: DENYLISTED_PAGE,
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "brand_asset_rejected");
  assert.ok(out.detail.some((d) => d.path === "/brand/accent_source" && d.reason === "third_party_mark_denylisted"));
});

test("a denylisted logo is STILL a hard fail (identity law unchanged)", async () => {
  const out = await resolveBrandAssets({
    logo: "https://www.facebook.com/mark-logo.png",
    accent_fallback: "#0C449A",
    accent_fallback_source: DENYLISTED_PAGE,
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "brand_asset_rejected");
  assert.ok(out.detail.some((d) => d.path === "/brand/logo" && d.reason === "third_party_mark_denylisted"));
});

test("a brand with no colour sources builds clean with nothing recorded as dropped", async () => {
  const out = await resolveBrandAssets({});
  assert.equal(out.ok, true);
  assert.equal(out.accent, null);
  assert.equal(out.dropped_colour_sources, undefined);
});
