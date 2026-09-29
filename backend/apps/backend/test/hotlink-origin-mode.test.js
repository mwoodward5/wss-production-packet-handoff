"use strict";

// test/hotlink-origin-mode.test.js — ORIGIN-MODE ECONOMICS + THE NO-HOTLINK
// LAW, locked.
//
// docs/standards/hotlink-until-pay.md (v1, owner directive 2026-08-17) had
// the unpaid preview reference the prospect's OWN media URLs. The 2026-09-04
// owner order reversed the PAGE-facing half (render-regression lane): OUR
// mirror never hotlinks the prospect's domain — every unpaid preview ships
// the donor family's own bundled media and nothing on the page depends on
// the prospect's hotlink protection. The economics the v1 directive wanted
// survive, and these pin the four properties that make the whole thing safe:
//
//   (a) origin mode emits a URL MANIFEST, not bytes — zero prospect bytes
//       housed, every entry verified (fetched + sniffed + sha256) for the
//       paid migration, AND the built page references ZERO prospect URLs:
//       the slots keep the donor's own bundled imagery, referenced by their
//       local slot paths in the HTML and the compiled bundles;
//   (b) housed mode (the default) places BYTES exactly as before — no
//       manifest, no prospect URLs either (the fleet-polish duplicate-gallery
//       replacements are local first-party assets, never origin URLs);
//   (c) an origin URL that dies (404) FAILS the render gate — the generic
//       dead-asset law is verified in a real browser load, never assumed;
//   (d) the mirror-request schema accepts exactly "origin" and "housed".

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-hotlink-"));

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { renderCheck } = require("../lib/mirror-engine/verify");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { siteEditLog } = require("../lib/site-edit-log");
const { loadDonor } = require("../lib/mirror-engine/donor");

const DONOR = "plumbing-premier";
const SLOT_ONE = "assets/water-heater-DUmyxTEf.jpg";
const BUNDLE = "assets/index-BAa9GPuc.js";

// A resolveBrandAssets stand-in with every network seam removed. The SHAPE is
// the real contract: housed photos carry bytes; origin photos carry the
// verified originUrl and NO bytes. Photos are distinct by sha and bytes.
function fakeResolveBrandAssets(mode) {
  const photos = [1, 2, 3].map((i) => ({
    url: `https://fixture-plumbing.example/p${i}.jpg`,
    ok: true,
    sha256: require("node:crypto").createHash("sha256").update(`photo-${i}`).digest("hex"),
    ext: "jpg",
    mime: "image/jpeg",
    ...(mode === "origin"
      ? { originUrl: `https://fixture-plumbing.example/final-p${i}.jpg` }
      : { bytes: Buffer.from(`FAKE CLIENT PHOTO BYTES ${i}`, "utf8") }),
  }));
  return async () => ({
    ok: true,
    logo: null,
    accent: null,
    primary: null,
    hashes: {},
    mediaMode: mode,
    photos,
    heroVideo: null,
  });
}

// The no-network deploy harness from test/edit-survives-rebuild.test.js: a
// full (non-dry) build where the only thing under test is what ends up in
// the deployed file tree.
function makeHarness({ mediaMode }) {
  let captured = null;
  const deps = {
    slugPolicy,
    siteEditLog: (args) => siteEditLog({ ...args, select: async () => ({ ok: true, mode: "live_select", data: [] }) }),
    resolveBrandAssets: fakeResolveBrandAssets(mediaMode),
    readArchivedFile: async () => null,
    withSpaRewrite: (files) => { captured = files; return files; },
    ensureProject: async () => "prj_stub",
    uploadFiles: async (files) => ({ manifest: Object.keys(files).map((f) => ({ file: f })), uploaded: 1, deduped: 0 }),
    createDeployment: async () => ({ id: "dpl_stub", url: "stub.vercel.app", readyState: "QUEUED" }),
    waitReady: async () => ({ readyState: "READY" }),
    byteDiff: async () => ({ clean: true, checked: 9, mismatches: [] }),
    deepLinkCheck: async () => ({ clean: true, failures: [] }),
    attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
    aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
    renderCheck: async () => ({ status: "passed", problems: [] }),
    renderAudit: async () => ({ status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] }),
  };
  return { deps, files: () => captured };
}

function buildRequest(slug, mediaMode) {
  return {
    slug,
    donor: DONOR,
    facts: {
      business_name: "Fixed Gear Plumbing",
      industry: "plumbing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
    },
    hero: { headline: "Pipes done once, done right" },
    brand: {
      ...(mediaMode ? { media_mode: mediaMode } : {}),
      photos: [1, 2, 3].map((i) => `https://fixture-plumbing.example/p${i}.jpg`),
    },
  };
}

// ---------------------------------------------------------------------------
// (a) ORIGIN MODE: URL MANIFEST, NOT BYTES — AND NO PROSPECT URLS ON THE PAGE
// ---------------------------------------------------------------------------
test("origin mode emits assets/wss-origin-media.json, places ZERO prospect bytes, and the page references ZERO prospect URLs", async () => {
  const h = makeHarness({ mediaMode: "origin" });
  const res = await mirror(buildRequest("wss-test-hotlink-origin-fixed-gear-plumbing", "origin"), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `origin build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);

  const files = h.files();
  assert.ok(files, "the build never reached the deploy stage");

  // The manifest exists, names its mode, and every entry is a verified
  // {slot, url, sha256} for a slot the donor actually references.
  const manifestRaw = files["assets/wss-origin-media.json"];
  assert.ok(manifestRaw, "origin mode writes assets/wss-origin-media.json");
  const manifest = JSON.parse(manifestRaw.toString("utf8"));
  assert.equal(manifest.media_mode, "origin");
  assert.ok(manifest.entries.length >= 1, "at least one photo slot is mapped");
  for (const entry of manifest.entries) {
    assert.match(entry.slot, /^assets\/[\w-]+\.jpg$/, `entry slot is a donor photo slot: ${entry.slot}`);
    assert.match(entry.url, /^https:\/\/fixture-plumbing\.example\/final-p\d\.jpg$/, "the entry URL is the prospect's VERIFIED origin URL");
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, "the entry carries the build-time sha256");
  }

  // NOT BYTES: the mapped slots still hold the DONOR's own imagery — none of
  // the fake client photo bytes may appear anywhere in the tree.
  const donorOriginal = loadDonor(path.join(__dirname, "..", "donors-clean", DONOR)).files[SLOT_ONE];
  for (const i of [1, 2, 3]) {
    const fake = Buffer.from(`FAKE CLIENT PHOTO BYTES ${i}`, "utf8");
    for (const [rel, buf] of Object.entries(files)) {
      if (Buffer.isBuffer(buf) && buf.equals(fake)) {
        assert.fail(`prospect photo bytes were housed in origin mode (${rel})`);
      }
    }
  }
  assert.ok(files[SLOT_ONE].equals(donorOriginal), "the donor's own slot bytes pass through untouched");

  // THE NO-HOTLINK LAW (owner order, 2026-09-04): the built page keeps the
  // donor family's own bundled media referenced by its LOCAL slot paths. No
  // file the deploy ships — HTML, compiled bundle, stylesheet — may carry a
  // prospect-origin URL. The compiled bundle that held the slot path as a
  // string constant STILL holds it.
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.(html|js|css)$/i.test(rel)) continue;
    const text = buf.toString("utf8");
    assert.ok(!text.includes("fixture-plumbing.example"),
      `origin mode leaked the prospect's origin into ${rel} — our mirror never hotlinks the prospect's domain`);
  }
  const bundle = files[BUNDLE].toString("utf8");
  assert.ok(bundle.includes(`"/${SLOT_ONE}"`), "the slot path is still referenced locally by the compiled bundle");

  // The evidence says which mode shipped, and the recorder names the ban —
  // never a silent no-op.
  assert.equal(res.body.checks.brand.media_mode, "origin");
  assert.equal(res.body.checks.brand.origin_media.applied, false);
  assert.match(res.body.checks.brand.origin_media.reason || "", /prospect_hotlinks_banned/,
    "the origin-media report names the no-hotlink policy state");
  assert.equal(res.body.checks.brand.origin_media.entries >= 1, true,
    "the verified entries are still recorded for the paid migration");
});

// ---------------------------------------------------------------------------
// (b) HOUSED MODE (the default): UNCHANGED
// ---------------------------------------------------------------------------
test("housed mode still places photo bytes and writes no manifest", async () => {
  const h = makeHarness({ mediaMode: "housed" });
  const res = await mirror(buildRequest("wss-test-hotlink-housed-fixed-gear-plumbing", "housed"), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `housed build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);

  const files = h.files();
  assert.ok(files, "the build never reached the deploy stage");
  assert.equal(files["assets/wss-origin-media.json"], undefined, "no URL manifest in housed mode");
  assert.equal(res.body.checks.brand.media_mode, "housed");

  // Byte placement, exactly as before — through the manifest's PROMINENCE
  // order (photo 1 lands in the highest-rendering slot, hero-plumber, not
  // the first manifest slot). The honest assertion is placement itself:
  // every one of the three photographs is housed in some slot, and the
  // water-heater slot carries one of their bytes.
  const fakeBytes = [1, 2, 3].map((i) => Buffer.from(`FAKE CLIENT PHOTO BYTES ${i}`, "utf8"));
  const housedShas = new Set(fakeBytes.map((b) => b.toString("hex")));
  assert.ok(housedShas.has(files[SLOT_ONE].toString("hex")),
    "the water-heater slot carries one of the client's housed photographs");
  const placedCount = Object.values(files)
    .filter((buf) => Buffer.isBuffer(buf) && housedShas.has(buf.toString("hex"))).length;
  assert.equal(placedCount, 3, "all three client photographs are housed in slots");
  const bundle = files[BUNDLE].toString("utf8");
  assert.ok(bundle.includes(`"/${SLOT_ONE}"`), "the slot path is still referenced locally");
  // THE NO-HOTLINK LAW RIDES HERE TOO: the fleet-polish duplicate-gallery
  // replacements used to be the client photo URLS verbatim (they hotlinked
  // the prospect even in housed mode). Replacements are first-party assets
  // now, so NOTHING the build ships may carry the prospect's origin.
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.(html|js|css)$/i.test(rel)) continue;
    assert.ok(!buf.toString("utf8").includes("fixture-plumbing.example"),
      `housed mode leaked the prospect's origin into ${rel} — replacements must be first-party assets`);
  }
});

// ---------------------------------------------------------------------------
// (c) A DEAD ORIGIN URL FAILS THE RENDER GATE
// ---------------------------------------------------------------------------
// The render gate loads the built page in a real browser and every response
// >= 400 from a non-tag-vendor host is fatal. An origin URL that 404s (the
// prospect moved a file, or their host hotlink-protects) is exactly such a
// response — so hotlinking is verified per build, never assumed. The fake
// browser below replays a 404 for the origin image the page requested.
function launchWithDeadOrigin(deadUrl) {
  return async () => ({
    newPage: async () => {
      const handlers = {};
      let evaluateCalls = 0;
      return {
        on: (event, handler) => { (handlers[event] = handlers[event] || []).push(handler); },
        goto: async () => {
          for (const handler of handlers.response || []) handler({ status: () => 404, url: () => deadUrl });
          return { status: () => 200 };
        },
        evaluate: async () => {
          evaluateCalls += 1;
          if (evaluateCalls === 1) return { present: false }; // hero video probe: no <video>
          if (evaluateCalls === 2) return "Fixed Gear Plumbing — honest work across Tucson."; // body text
          return { bodyChars: 220, rootChildren: 3, h1Visible: true, interactiveCount: 6 }; // hydration probe
        },
        close: async () => {},
      };
    },
    close: async () => {},
  });
}

test("an origin URL that 404s FAILS the render gate", async () => {
  const dead = "https://fixture-plumbing.example/final-p1.jpg";
  const verdict = await renderCheck("https://wss-test-hotlink-origin-fixed-gear-plumbing.wss-ai.com/", {
    launch: launchWithDeadOrigin(dead),
    timeoutMs: 5_000,
  });
  assert.equal(verdict.status, "failed", "a dead origin asset must fail the render check");
  assert.ok(
    (verdict.failed_requests || []).some((r) => r.url === dead && r.error === "http_404"),
    `the dead origin URL is named in the evidence: ${JSON.stringify(verdict.failed_requests)}`,
  );
  assert.ok(verdict.problems.some((p) => String(p).startsWith("failed_requests:")));
});

test("the same page with a LIVE origin URL passes the render gate", async () => {
  // Control for (c): the gate is failing the dead ASSET, not origin URLs as a
  // class. Same fake browser, but every response is 200.
  const launch = async () => ({
    newPage: async () => {
      const handlers = {};
      let evaluateCalls = 0;
      return {
        on: (event, handler) => { (handlers[event] = handlers[event] || []).push(handler); },
        goto: async () => ({ status: () => 200 }),
        evaluate: async () => {
          evaluateCalls += 1;
          if (evaluateCalls === 1) return { present: false };
          if (evaluateCalls === 2) return "Fixed Gear Plumbing — honest work across Tucson.";
          return { bodyChars: 220, rootChildren: 3, h1Visible: true, interactiveCount: 6 };
        },
        close: async () => {},
      };
    },
    close: async () => {},
  });
  const verdict = await renderCheck("https://wss-test-hotlink-origin-fixed-gear-plumbing.wss-ai.com/", {
    launch, timeoutMs: 5_000,
  });
  assert.equal(verdict.status, "passed", JSON.stringify(verdict.problems));
});

// ---------------------------------------------------------------------------
// (d) THE SCHEMA ACCEPTS BOTH MODES — AND ONLY THE TWO
// ---------------------------------------------------------------------------
test("mirror-request schema accepts media_mode origin and housed, and refuses anything else", () => {
  const base = {
    slug: "wss-test-schema-media-mode",
    facts: { business_name: "Fixed Gear Plumbing", industry: "plumbing", city: "Tucson", state: "AZ" },
  };
  for (const media_mode of ["origin", "housed"]) {
    const out = checkMirrorRequest({ ...base, brand: { media_mode } });
    assert.equal(out.ok, true, `media_mode:${media_mode} must validate — ${JSON.stringify(out.body || {}).slice(0, 300)}`);
    assert.equal(out.request.brand.media_mode, media_mode);
  }
  // Absent is still valid: housed is the engine's default, not the schema's job.
  assert.equal(checkMirrorRequest(base).ok, true);
  // A typo is a 400 at the boundary, never a silent default.
  const bad = checkMirrorRequest({ ...base, brand: { media_mode: "hotlink" } });
  assert.equal(bad.ok, false);
  assert.ok((bad.body.detail || []).some((d) => d.path === "/brand/media_mode" && d.keyword === "enum"),
    `the enum violation names the field: ${JSON.stringify(bad.body.detail)}`);
});
