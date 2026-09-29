"use strict";

// test/hero-poster.test.js — THE HERO POSTER CONTRACT (audit A1, 2026-09-03).
//
// The 10 hvac builds of line_mtn6z9sl shipped a hero whose first-second
// surface — the poster tile, PERMANENT on mobile where the video ladder
// never arms below 1024px — was broken three ways: an emitted
// `assets/hero-poster.<ext>` reference whose extension drifted with the
// photo pool and was never asserted to resolve to shipped bytes; the
// donor's drawn svg placeholder on empty-pool builds; and unvetted
// pool[0] photography (a Colorado service-area map on a Spring TX site,
// a route diagram on a Michigan one).
//
// This suite holds the three laws that fix it:
//
//   1. POSTER-SHIPS — on the COMPILED build (real hvac-premier donor,
//      real engine, files captured through the shared-publisher seam),
//      every hero-poster reference resolves to an asset present in the
//      emitted bundle with image magic bytes, the visible tile is a real
//      photograph, and an onerror guard falls back to the donor's bundled
//      real photo.
//   2. SELECTION — media-provenance gates (map/logo/stock refuse), region
//      tags (match widens eligibility, mismatch refuses, region-tagged
//      wins over untagged), and the neutral donor-photo fallback when
//      nothing qualifies.
//   3. SCOPE — donors with no real raster poster (the drawn-svg-poster
//      donors) are left untouched, tree byte-identical.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");

// The REAL donor library, not a fixture root: this suite exists to catch a
// regression in the shipped donor emission contract itself.
process.env.MIRROR_DONOR_ROOT = path.join(BACKEND, "donors-clean");
// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-hero-poster-"));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
if (!process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY) {
  process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY = "hero-poster-test-key-00000000000000000";
}

const heroPosterLib = require("../lib/mirror-engine/hero-poster");
const { loadDonor } = require("../lib/mirror-engine/donor");

const DONOR_DIR = path.join(BACKEND, "donors-clean", "hvac-premier");
const DONOR_FILES = () => loadDonor(DONOR_DIR).files;

// Minimal magic-byte photographs (the pass sniffs, it does not decode).
const JPG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(64, 0x2a),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from("WEBP"),
  Buffer.from("VP8 "), Buffer.alloc(48, 0x2a),
]);
const sha = (tag) => require("node:crypto").createHash("sha256").update(tag).digest("hex");

const MI_FACTS = { business_name: "Hurst Mechanical", industry: "hvac", city: "Grand Rapids", state: "MI", phone: "+16165550142" };
const TX_FACTS = { business_name: "Earth Power AC and Heat", industry: "hvac", city: "Spring", state: "TX", phone: "+12815550142" };

const photo = (url, over = {}) => ({
  url, ok: true, sha256: sha(url), ext: "jpg", mime: "image/jpeg",
  bytes: Buffer.concat([JPG, Buffer.from(url)]), width: 1600, height: 900,
  source: "own_site", ...over,
});

// ---------------------------------------------------------------------------
// 2. SELECTION — the region/type gates (unit level, fast)
// ---------------------------------------------------------------------------

test("a wrong-region image is excluded from the hero poster (the Colorado-map case)", () => {
  const out = heroPosterLib.selectHeroPosterPhoto({
    usablePhotos: [photo("https://client.example.com/service-area-map-colorado.jpg")],
    facts: TX_FACTS,
    vertical: "hvac",
  });
  assert.equal(out.photo, null);
  assert.ok(out.rejected.some((r) => /map_is_not_work_media|region_mismatch/.test(r.reason)),
    `map refused for hero: ${JSON.stringify(out.rejected)}`);
});

test("a region-tagged work photograph wins over an untagged equal", () => {
  const out = heroPosterLib.selectHeroPosterPhoto({
    usablePhotos: [
      photo("https://client.example.com/gallery-jobs/untitled-001.jpg"),
      photo("https://client.example.com/gallery-texas-rooftop-units.jpg"),
    ],
    facts: TX_FACTS,
    vertical: "hvac",
  });
  assert.ok(out.photo, "a winner exists");
  assert.match(out.photo.url, /texas-rooftop/);
  assert.equal(out.choice, "client_region_tagged_photo");
  const row = out.ranked.find((r) => /texas-rooftop/.test(r.url));
  assert.equal(row.region_tag, "match");
  assert.equal(row.score, 25);
});

test("an unclassified opaque photograph is NOT hero media without a region tag (neutral fallback governs)", () => {
  const out = heroPosterLib.selectHeroPosterPhoto({
    usablePhotos: [photo("https://lh3.googleusercontent.com/a/ACg8ocK-opaque-token")],
    facts: MI_FACTS,
    vertical: "hvac",
  });
  assert.equal(out.photo, null);
  assert.ok(out.rejected.some((r) => /ineligible_for_hero:generic_stock/.test(r.reason)));
});

test("the bank's current_hero flag outranks a region tag", () => {
  const out = heroPosterLib.selectHeroPosterPhoto({
    usablePhotos: [
      photo("https://client.example.com/gallery-texas-rooftop-units.jpg"),
      photo("https://client.example.com/homes/hero-home-tx.jpg"),
    ],
    bank: { photos: [{ url: "https://client.example.com/homes/hero-home-tx.jpg", current_hero: true }] },
    facts: TX_FACTS,
    vertical: "hvac",
  });
  assert.ok(out.photo);
  assert.equal(out.choice, "client_current_hero");
});

test("stock-suspect media can never become the poster, flagged or not", () => {
  const out = heroPosterLib.selectHeroPosterPhoto({
    usablePhotos: [photo("https://client.example.com/photos/desert-stock-install.jpg")],
    bank: { photos: [{ url: "https://client.example.com/photos/desert-stock-install.jpg", stock_caption_suspect: true, current_hero: true }] },
    facts: TX_FACTS,
    vertical: "hvac",
  });
  assert.equal(out.photo, null);
  assert.ok(out.rejected.some((r) => /stock_media_not_proof/.test(r.reason)));
});

// ---------------------------------------------------------------------------
// 3. EMISSION + 1. POSTER-SHIPS — the pass over the real donor tree
// ---------------------------------------------------------------------------

test("empty pool: the drawn placeholder is retired for the donor's real photo and every reference ships", () => {
  const files = DONOR_FILES();
  const manifest = JSON.parse(fs.readFileSync(path.join(DONOR_DIR, "BOILERPLATE.json"), "utf8"));
  const out = heroPosterLib.applyHeroPosterPass({
    files,
    manifest,
    donorDir: DONOR_DIR,
    facts: MI_FACTS,
    vertical: "hvac",
    usablePhotos: [],
  });
  assert.equal(out.applied, true, `pass applied: ${out.reason}`);
  assert.equal(out.choice, "donor_real_photo_fallback");
  assert.equal(out.poster_rel, "hero/hero-poster.jpg");

  const html = files["index.html"].toString("utf8");
  // The visible hero tile no longer points at the drawn placeholder.
  const heroImg = /<img[^>]*hero-poster[^>]*>/.exec(html);
  assert.ok(heroImg, "the hero poster img is present");
  assert.match(heroImg[0], /src="hero\/hero-poster\.jpg"/);
  // …and it carries the onerror guard to the bundled real photo.
  assert.match(heroImg[0], /onerror="this\.onerror=null;this\.src='hero\/hero-poster\.jpg'"/);
  // The share surfaces ride along: no svg poster reference survives.
  assert.ok(!/hero-poster\.svg/.test(html), "no hero-poster.svg reference remains in the page");

  // THE COMPILE-TIME ASSERTION: every hero-poster reference on every page
  // resolves to a shipped asset with image magic bytes.
  const proof = heroPosterLib.assertHeroPosterShips({ files, fallbackRel: "hero/hero-poster.jpg" });
  assert.equal(proof.ok, true, `poster ships: ${JSON.stringify(proof.dangling)}`);
  assert.ok(proof.refs >= 3, `og:image + tile img + video poster all checked (saw ${proof.refs})`);
});

test("extension drift: a slot-fill webp poster is normalized to one reference that provably ships", () => {
  const files = DONOR_FILES();
  const manifest = JSON.parse(fs.readFileSync(path.join(DONOR_DIR, "BOILERPLATE.json"), "utf8"));
  // Reproduce the slot-fill serverless fallback's output shape: the svg
  // slot rewritten to a webp that DID ship…
  files["assets/hero-poster.webp"] = WEBP;
  for (const rel of ["index.html"]) {
    files[rel] = Buffer.from(
      files[rel].toString("utf8").split("assets/hero-poster.svg").join("assets/hero-poster.webp"),
      "utf8",
    );
  }
  // …then a provenance-clean, region-tagged jpg photograph arrives with the
  // hero-poster pass.
  const out = heroPosterLib.applyHeroPosterPass({
    files,
    manifest,
    donorDir: DONOR_DIR,
    facts: TX_FACTS,
    vertical: "hvac",
    usablePhotos: [photo("https://client.example.com/gallery-texas-rooftop-units.jpg")],
  });
  assert.equal(out.applied, true);
  assert.equal(out.choice, "client_region_tagged_photo");
  assert.equal(out.poster_rel, "assets/hero-poster.jpg");
  assert.ok(files["assets/hero-poster.jpg"].slice(0, 4).equals(JPG.slice(0, 4)));

  const html = files["index.html"].toString("utf8");
  assert.ok(!/hero-poster\.webp/.test(html), "the drifted webp reference is gone");
  assert.ok(!/hero-poster\.svg/.test(html), "the placeholder svg reference is gone");
  const proof = heroPosterLib.assertHeroPosterShips({ files, fallbackRel: out.fallback_rel });
  assert.equal(proof.ok, true, `poster ships: ${JSON.stringify(proof.dangling)}`);
});

test("the assertion self-heals a dangling poster reference to the bundled fallback", () => {
  const files = DONOR_FILES();
  const manifest = JSON.parse(fs.readFileSync(path.join(DONOR_DIR, "BOILERPLATE.json"), "utf8"));
  files["index.html"] = Buffer.from(
    files["index.html"].toString("utf8").split("assets/hero-poster.svg").join("assets/hero-poster.webp"),
    "utf8",
  );
  delete files["assets/hero-poster.svg"]; // nothing answers either form now
  const proof = heroPosterLib.assertHeroPosterShips({ files, fallbackRel: "hero/hero-poster.jpg" });
  assert.equal(proof.ok, true, `healed: ${JSON.stringify(proof.dangling)} healed=${proof.healed}`);
  assert.ok(proof.healed >= 2, `og:image + tile img healed (saw ${proof.healed})`);
  const html = files["index.html"].toString("utf8");
  assert.ok(!/hero-poster\.webp/.test(html));
  assert.match(html, /hero\/hero-poster\.jpg/);
});

test("scope: a donor whose declared poster is the drawn svg itself is untouched", () => {
  const files = { "index.html": Buffer.from('<img src="assets/hero-poster.svg" alt="x">') };
  files["assets/hero-poster.svg"] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const snapshot = { ...files };
  const out = heroPosterLib.applyHeroPosterPass({
    files,
    manifest: { photo_slots: ["assets/hero-poster.svg"], hero_video: { poster: "assets/hero-poster.svg" } },
    facts: MI_FACTS,
    vertical: "hvac",
    usablePhotos: [],
  });
  assert.equal(out.applied, false);
  assert.equal(out.reason, "donor_poster_not_a_real_photo");
  assert.deepEqual(Object.keys(files), Object.keys(snapshot));
  assert.equal(files["index.html"].toString("utf8"), snapshot["index.html"].toString("utf8"));
});

// ---------------------------------------------------------------------------
// 1. POSTER-SHIPS — the law on the COMPILED build (real engine, real donor)
// ---------------------------------------------------------------------------

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

/** Compile the real hvac-premier donor with the deploy/render seams stubbed,
 *  capturing the exact tree the customer would receive. */
async function compileHvac({ slug, facts, photos }) {
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
    resolveBrandAssets: async () => ({
      ok: true, logo: null, accent: null, primary: null, hashes: {}, mediaMode: "housed",
      photos, heroVideo: null,
    }),
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

test("COMPILED: an empty-photo Michigan build ships a real poster that provably resolves", { timeout: 240_000 }, async () => {
  const { manifest, captured } = await compileHvac({
    slug: "wss-test-heromedia-hurst-mechanical",
    facts: MI_FACTS,
    photos: [],
  });
  const hp = manifest.checks.hero_poster;
  assert.equal(hp.status, "applied");
  assert.equal(hp.choice, "donor_real_photo_fallback");
  assert.equal(hp.poster_rel, "hero/hero-poster.jpg");
  assert.equal(hp.poster_ships, true, `compiled poster ships: ${JSON.stringify(hp)}`);

  const html = captured["index.html"].toString("utf8");
  const heroImg = /<img[^>]*hero-poster[^>]*>/.exec(html);
  assert.ok(heroImg, "the compiled hero tile img exists");
  assert.match(heroImg[0], /src="hero\/hero-poster\.jpg"/);
  assert.match(heroImg[0], /onerror="this\.onerror=null/);
  assert.ok(!/hero-poster\.svg/.test(html), "the drawn placeholder is unreferenced");
  assert.ok(captured["hero/hero-poster.jpg"], "the fallback bytes ship");
  assert.ok(captured["hero/hero-poster.jpg"][0] === 0xff && captured["hero/hero-poster.jpg"][1] === 0xd8,
    "the shipped poster is real JPEG bytes");

  // The compiled tree, re-asserted from the outside: every reference resolves.
  const proof = heroPosterLib.assertHeroPosterShips({ files: captured, fallbackRel: "hero/hero-poster.jpg" });
  assert.equal(proof.ok, true, `compiled tree dangling: ${JSON.stringify(proof.dangling)}`);
});

test("COMPILED: the map is refused, the region-tagged photograph becomes the poster", { timeout: 240_000 }, async () => {
  const rooftop = photo("https://client.example.com/gallery-texas-rooftop-units.jpg");
  const { manifest, captured } = await compileHvac({
    slug: "wss-test-heromedia-earth-power",
    facts: TX_FACTS,
    photos: [
      photo("https://client.example.com/service-area-map-colorado.jpg"),
      rooftop,
    ],
  });
  const hp = manifest.checks.hero_poster;
  assert.equal(hp.choice, "client_region_tagged_photo");
  assert.equal(hp.poster_sha, rooftop.sha256);
  assert.equal(hp.poster_rel, "assets/hero-poster.jpg");
  assert.equal(hp.poster_ships, true);
  assert.ok(hp.selection.rejected.some((r) => /map_is_not_work_media|region_mismatch/.test(r.reason)),
    "the Colorado map is refused by name");
  assert.ok(captured["assets/hero-poster.jpg"].equals(rooftop.bytes),
    "the emitted poster bytes are the region-tagged photograph's");
});
