"use strict";

// test/climate-copy-guard.test.js — THE CLIMATE-STRING COPY GUARD
// (audit A1, 2026-09-03).
//
// The hvac-premier donor's literal hero headline — "Cooling engineered for
// a 118-degree afternoon" — shipped to West Michigan, Princeton NJ and
// John's Island SC on 10/10 builds. The donor's <h1> carries no copy
// token, so no identity pass could re-own it: authored regional color
// became every region's claim.
//
// The laws this suite holds:
//   1. A climate claim ships ONLY to a region whose climate licenses it
//      (118-degree-scale heat is desert copy; MI/NJ/SC-style regions get
//      their own regional phrase; an unknown region gets the fully
//      climate-neutral line).
//   2. The guard covers every emission surface the claim can ride:
//      h1, title, meta/og/twitter content, alt text, hero-region <p>/<span>.
//   3. Provenance is recorded (copy_slot: region_guard) and the guard is
//      idempotent — a guarded page guards to zero on re-run.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
process.env.MIRROR_DONOR_ROOT = path.join(BACKEND, "donors-clean");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-climate-"));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
if (!process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY) {
  process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY = "climate-guard-test-key-000000000000000";
}

const {
  climateOf,
  guardClimateCopyText,
  applyClimateCopyGuard,
  carriesUnlicensedClaim,
} = require("../lib/mirror-engine/climate-copy-guard");

const DONOR_HTML = () =>
  fs.readFileSync(path.join(BACKEND, "donors-clean", "hvac-premier", "index.html"), "utf8");

// ---------------------------------------------------------------------------
// 1. The claim gates, region by region
// ---------------------------------------------------------------------------

test("118-degree copy is blocked for MI/NJ/SC-style regions and allowed for Phoenix", () => {
  const donor = DONOR_HTML();
  for (const [state, city] of [["MI", "Grand Rapids"], ["NJ", "Princeton"], ["SC", "Johns Island"]]) {
    const out = guardClimateCopyText(donor, { state, city });
    assert.ok(!/118-degree/i.test(out.html), `${state} still carries the 118-degree claim`);
    assert.ok(out.replacements.some((r) => r.claim === "extreme_heat" && r.surface === "h1"),
      `${state} h1 swap recorded: ${JSON.stringify(out.replacements)}`);
  }
  const az = guardClimateCopyText(donor, { state: "AZ", city: "Phoenix" });
  assert.match(az.html, /118-degree afternoon/, "Phoenix keeps the authored desert claim");
  assert.equal(az.replacements.length, 0);
});

test("the regional replacements are the region's own weather, not a shrug", () => {
  const donor = DONOR_HTML();
  const mi = guardClimateCopyText(donor, { state: "MI", city: "Grand Rapids" });
  assert.match(mi.html, /a 95-degree heat wave/, "humid-continental regions get their heat-wave line");
  const nj = guardClimateCopyText(donor, { state: "NJ", city: "Princeton" });
  assert.match(nj.html, /a 96-degree heat dome/, "midatlantic regions get the heat-dome line");
  const sc = guardClimateCopyText(donor, { state: "SC", city: "Johns Island" });
  assert.match(sc.html, /a 97-degree afternoon with 90% humidity/, "hot-humid regions get the humidity line");
});

test("unknown regions fall back to climate-neutral copy", () => {
  const donor = DONOR_HTML();
  const out = guardClimateCopyText(donor, { state: "", city: "" });
  assert.ok(!/118-degree/.test(out.html));
  assert.match(out.html, /the hottest afternoon of the year/);
});

test("desert/monsoon vocabulary is climate-gated everywhere it rides", () => {
  const html = [
    "<title>Comfort through a monsoon season</title>",
    '<meta name="description" content="Desert-tested cooling for a 115-degree day.">',
    '<h1>Cooling engineered for a 118-degree afternoon</h1>',
    '<img alt="Rooftop package cooling unit on a desert contemporary home">',
    '<section class="hero"><p>Built for the high desert.</p></section>',
  ].join("\n");
  const mi = guardClimateCopyText(html, { state: "MI", city: "Grand Rapids" });
  const page = mi.html;
  assert.ok(!/monsoon|desert|118-degree|115-degree/i.test(page), `MI page fully de-climated: ${page.slice(0, 200)}`);
  assert.match(page, /rainstorm/);
  assert.match(page, /modern home/);
  assert.match(page, /sun-baked/);
  const surfaces = new Set(mi.replacements.map((r) => r.surface));
  for (const expected of ["title", "meta", "alt", "h1", "body_p"]) {
    assert.ok(surfaces.has(expected), `surface ${expected} guarded (saw ${[...surfaces].join(",")})`);
  }
});

test("lake-effect and nor'easter copy is licensed only where it is true", () => {
  const cold = "<h1>Ready for a lake-effect January</h1>";
  assert.doesNotMatch(guardClimateCopyText(cold, { state: "MI" }).html, /winter January/);
  assert.match(guardClimateCopyText(cold, { state: "AZ", city: "Phoenix" }).html, /winter January/);
  const coastal = "<h1>Storm-ready after every nor'easter</h1>";
  assert.doesNotMatch(guardClimateCopyText(coastal, { state: "NJ" }).html, /winter storm/);
  assert.match(guardClimateCopyText(coastal, { state: "TX", city: "Houston" }).html, /winter storm/);
});

test("climateOf maps the audited fleet's regions to their climates", () => {
  assert.equal(climateOf({ state: "AZ", city: "Phoenix" }), "desert");
  assert.equal(climateOf({ state: "NM", city: "Albuquerque" }), "desert");
  assert.equal(climateOf({ state: "TX", city: "Houston" }), "hot_humid");
  assert.equal(climateOf({ state: "TX", city: "Spring" }), "hot_humid");
  assert.equal(climateOf({ state: "MI", city: "Grand Rapids" }), "humid_continental");
  assert.equal(climateOf({ state: "NJ", city: "Princeton" }), "midatlantic");
  assert.equal(climateOf({ state: "SC", city: "Johns Island" }), "hot_humid");
  assert.equal(climateOf({ state: "" }), "unknown");
});

// ---------------------------------------------------------------------------
// 2. Provenance + idempotency (files level)
// ---------------------------------------------------------------------------

test("applyClimateCopyGuard records copy_slot: region_guard provenance and is idempotent", () => {
  const files = { "index.html": Buffer.from(DONOR_HTML()) };
  const report = applyClimateCopyGuard({ files, facts: { state: "MI", city: "Grand Rapids" } });
  assert.equal(report.applied, true);
  assert.equal(report.climate, "humid_continental");
  assert.deepEqual(report.region, { state: "MI", city: "Grand Rapids" });
  assert.ok(report.replacements.length >= 2, "h1 + alt both recorded");
  assert.ok(report.replacements.every((r) => r.from && r.to && r.claim && r.page));
  const guarded = files["index.html"].toString("utf8");
  assert.ok(!carriesUnlicensedClaim(guarded, "humid_continental"), "the guarded page carries no unlicensed claim");

  const again = applyClimateCopyGuard({ files, facts: { state: "MI", city: "Grand Rapids" } });
  assert.equal(again.replacements.length, 0, "the guard re-runs to zero");
  assert.equal(again.pages, 0);
});

test("a licensed region's files pass through byte-identical", () => {
  const before = Buffer.from(DONOR_HTML());
  const files = { "index.html": Buffer.from(before) };
  const report = applyClimateCopyGuard({ files, facts: { state: "AZ", city: "Phoenix" } });
  assert.equal(report.applied, false);
  assert.equal(report.reason, "no_climate_claims_or_region_licensed");
  assert.ok(files["index.html"].equals(before), "Phoenix ships the donor bytes untouched");
});

// ---------------------------------------------------------------------------
// 3. The compiled build (real engine, real donor)
// ---------------------------------------------------------------------------

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

async function compileHvac({ slug, facts }) {
  const HOST = `${slug}.wss-ai.com`;
  const captured = {};
  let routeMap = {};
  const serveFile = (url) => {
    const u = new URL(url);
    let rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    let buf = captured[rel];
    if (!buf) {
      const mapped = routeMap[u.pathname] || routeMap[`${u.pathname}/`];
      if (mapped) buf = captured[mapped];
    }
    return { status: buf ? 200 : 404, body: buf || Buffer.from("x") };
  };
  const deps = {
    siteEditLog: async () => ({ ok: true, configured: false, fingerprint: "", active: [], revoked: [], legacy: [] }),
    resolveBrandAssets: async () => ({ ok: true, logo: null, accent: null, primary: null, hashes: {}, mediaMode: "housed", photos: [], heroVideo: null }),
    sharedPublisher: {
      supportsTwoPhaseQc: true,
      stage: async (input) => {
        Object.assign(captured, input.files);
        routeMap = input.routeMap || {};
        return {
          ok: true, state: "staged", previewUrl: `https://${HOST}/`,
          proofIdentity: { site_id: "1", release_id: "2", build_hash: input.buildHash },
          releaseEvidence: {
            evidence_schema: "shared-site-release-evidence-v1", site_id: "1", release_id: "2",
            build_hash: input.buildHash, canonical_host: HOST, manifest_path: "m.json",
            manifest_sha256: "a".repeat(64), generation: 1, deployment_env: "production",
          },
          openPreview: async () => ({
            origin: `https://${HOST}/`,
            fetch: async (url) => {
              const f = serveFile(url);
              return {
                ok: f.status === 200, status: f.status,
                headers: { get: () => "application/octet-stream" },
                text: async () => f.body.toString("utf8"),
                arrayBuffer: async () => {
                  const ab = new ArrayBuffer(f.body.length);
                  new Uint8Array(ab).set(f.body);
                  return ab;
                },
              };
            },
            preparePage: async () => {},
          }),
        };
      },
      activate: async (receipt) => ({ ok: true, previewUrl: `https://${HOST}/`, proofIdentity: receipt.proofIdentity }),
    },
    renderCheck: async () => ({ status: "passed", problems: [] }),
    renderAudit: async () => ({ status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] }),
  };
  const result = await mirror({ slug, donor: "hvac-premier", facts }, { registry: createRegistry(), deps });
  assert.equal(result.ok, true, `hvac compile failed: ${JSON.stringify(result.body).slice(0, 600)}`);
  return { manifest: result.body, captured };
}

test("COMPILED: a Michigan build ships no 118-degree/desert copy and records the guard", { timeout: 240_000 }, async () => {
  const { manifest, captured } = await compileHvac({
    slug: "wss-test-climateguard-hurst-mechanical",
    facts: { business_name: "Hurst Mechanical", industry: "hvac", city: "Grand Rapids", state: "MI", phone: "+16165550142" },
  });
  const html = captured["index.html"].toString("utf8");
  assert.ok(!/118-degree/.test(html), "the compiled Michigan page has no 118-degree claim");
  assert.ok(!/desert/i.test(html), "the compiled Michigan page has no desert vocabulary");
  assert.match(html, /95-degree heat wave/, "the regional replacement is in the compiled h1");

  const guard = manifest.checks.copy_slot && manifest.checks.copy_slot.region_guard;
  assert.ok(guard, "copy_slot.region_guard provenance is in the manifest");
  assert.equal(guard.applied, true);
  assert.equal(guard.climate, "humid_continental");
  assert.ok(guard.replacements.some((r) => r.claim === "extreme_heat" && r.surface === "h1"));
});

test("COMPILED: a Phoenix build keeps the authored desert claim", { timeout: 240_000 }, async () => {
  const { manifest, captured } = await compileHvac({
    slug: "wss-test-climateguard-saguaro-air",
    facts: { business_name: "Saguaro Air Conditioning", industry: "hvac", city: "Phoenix", state: "AZ", phone: "+16025550166" },
  });
  const html = captured["index.html"].toString("utf8");
  assert.match(html, /118-degree afternoon/, "the compiled Phoenix page keeps the authored claim");
  const guard = manifest.checks.copy_slot.region_guard;
  assert.equal(guard.applied, false);
});
