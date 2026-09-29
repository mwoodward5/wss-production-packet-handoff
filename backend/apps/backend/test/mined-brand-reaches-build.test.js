"use strict";

// test/mined-brand-reaches-build.test.js — THE LOGO THE MINER ALREADY PAID FOR
// has to reach the build.
//
// Measured 2026-08-06. Simmons Plumbing and Mechanical LLC. (Albuquerque) and
// All Home Plumbing Co. (Chattanooga) were mined, qualified and persisted with a
// complete build-ready contract:
//
//   record.build_ready.brand_evidence  = { logo_url, logo_sha256, accent,
//                                          accent_origin: "measured_from_logo(...)" }
//   record.build_ready.mirror_request.brand = { logo, logo_sha256, accent, accent_source }
//
// Both were then refused as "mirror_build_not_revealable". Reproduced through
// full-run's dispatch, the engine answered:
//
//   brand: { status: "unbranded", logo: "wordmark-fallback",
//            accent: "donor-default", accent_origin: "none" }
//
// The cause was one line: prospectBuildInput read the logo from
// prospect.logo_url / prospect.logo / record.logo_url, and a mined row has none
// of those — its mark lives INSIDE record.build_ready. brand is a required check
// for revealable, so those builds could never be shown to anyone and the deploy
// was spent to learn nothing.
//
// These tests lock the two halves of the fix: one reader for where the logo
// really lives (used by BOTH build entry points, so they cannot drift apart
// again), and the frozen wordmark downgrade for a lead that genuinely has no
// mark. A supplied foreign candidate still refuses below.

const test = require("node:test");
const assert = require("node:assert/strict");

const { verifiedBrandOf } = require("../lib/prospects");
const { prospectBuildInput, dispatchMirrorLane } = require("../lib/full-run");
const { buildMirrorForProspect } = require("../lib/mirror-lane-build");

// The Simmons row as the store holds it, trimmed to the fields under test.
//
// READ THE LOGO FILENAME. It says "mastercool", and on 2026-08-06 those bytes
// were fetched and looked at: they are Mastercool, Inc.'s registered trademark,
// a manufacturer badge sitting in Simmons's own WordPress uploads. That is a
// separate defect from the one this file is about, and it now has its own gate
// (reason "logo_third_party_mark") and its own test at the bottom.
//
// The row is kept verbatim anyway, because it is the real reproduction: these
// first tests are about WHERE a mined lead's mark is stored and whether the two
// build entry points can both find it. They say nothing about whether the mark
// is legitimately the client's — that question is answered downstream, and the
// answer for this exact URL is "no".
const MINED_ROW = Object.freeze({
  prospect_id: "wss-test-simmons-plumbing-mechanical-albuquerque",
  business_name: "Simmons Plumbing and Mechanical LLC.",
  industry: "plumbing",
  city: "Albuquerque",
  state: "NM",
  current_website: "https://simmonsplumbing.info/",
  record: {
    prospect_id: "wss-test-simmons-plumbing-mechanical-albuquerque",
    business_name: "Simmons Plumbing and Mechanical LLC.",
    industry: "plumbing",
    city: "Albuquerque",
    state: "NM",
    build_ready: {
      version: 1,
      brand_evidence: {
        logo_url: "https://simmonsplumbing.info/wp-content/uploads/2017/03/mastercool-logo10874446.png",
        logo_sha256: "844aa338408581378e1ea5bef3d204da0c62afd651f7c703fcc0bafa6ce91d41",
        accent: "#03a1fa",
        accent_origin: "measured_from_logo(png-js, share 0.38)",
      },
      mirror_request: {
        slug: "wss-test-simmons-plumbing-mechanical-albuquerque",
        donor: "plumbing-clean",
        facts: { business_name: "Simmons Plumbing and Mechanical LLC.", industry: "plumbing", city: "Albuquerque", state: "NM" },
        brand: {
          logo: "https://simmonsplumbing.info/wp-content/uploads/2017/03/mastercool-logo10874446.png",
          logo_sha256: "844aa338408581378e1ea5bef3d204da0c62afd651f7c703fcc0bafa6ce91d41",
          accent: "#03a1fa",
          accent_source: "https://simmonsplumbing.info/wp-content/uploads/2017/03/mastercool-logo10874446.png",
        },
      },
    },
  },
});

const SIMMONS_LOGO = MINED_ROW.record.build_ready.brand_evidence.logo_url;

test("the miner's verified logo is found inside the build-ready contract", () => {
  const brand = verifiedBrandOf(MINED_ROW);
  assert.equal(brand.logo, SIMMONS_LOGO, "the mark the miner fetched, hashed and measured");
  assert.equal(brand.logo_sha256, "844aa338408581378e1ea5bef3d204da0c62afd651f7c703fcc0bafa6ce91d41");
  assert.equal(brand.accent, "#03a1fa");
});

test("brand_evidence alone is enough — a contract whose request block has no mark still builds branded", () => {
  const row = JSON.parse(JSON.stringify(MINED_ROW));
  delete row.record.build_ready.mirror_request.brand;
  assert.equal(verifiedBrandOf(row).logo, SIMMONS_LOGO);
});

test("rows that predate the contract are read exactly as before", () => {
  assert.equal(verifiedBrandOf({ logo_url: "https://acme.com/logo.png" }).logo, "https://acme.com/logo.png");
  assert.equal(verifiedBrandOf({ record: { logo: "https://acme.com/mark.svg" } }).logo, "https://acme.com/mark.svg");
  assert.equal(verifiedBrandOf({ record: { brand_color: "#123456" } }).accent, "#123456");
  // A LeadMiner truth-packet row carries build_ready as a BOOLEAN flag, not a
  // contract. Reading `true.mirror_request` must not throw or invent a logo.
  // accent_source joined the shape when the miner's colour became usable as a
  // fallback (see the accent tests below). The assertion here is unchanged in
  // intent: nothing is invented and nothing throws.
  const EMPTY = { logo: "", logo_sha256: "", accent: "", accent_source: "" };
  assert.deepEqual(
    verifiedBrandOf({ record: { build_ready: true, truth_packet_source: "leadminer_mirror_ready" } }),
    EMPTY,
  );
  for (const junk of [null, undefined, "", 0, false, "a string", 42]) {
    assert.deepEqual(verifiedBrandOf(junk), EMPTY, `threw or leaked on ${JSON.stringify(junk)}`);
  }
});

test("the dashboard build input carries the mined logo (the line that shipped Simmons unbranded)", () => {
  assert.equal(prospectBuildInput(MINED_ROW, {}).logo_url, SIMMONS_LOGO);
});

test("the mined logo survives the whole dashboard dispatch and reaches mirror()", async () => {
  let seen = null;
  await dispatchMirrorLane(prospectBuildInput(MINED_ROW, {}), {
    buildMirror: async (input) => {
      seen = input;
      return { ok: true, revealable: true, preview_url: "https://x.wss-ai.com/", slug: "x", donor: "plumbing-clean" };
    },
  });
  assert.equal(seen.logo, SIMMONS_LOGO, "buildMirrorForProspect is handed the stored mark, not nothing");
});

test("an http-only mark is refused early, in words, instead of as a blunt 400", async () => {
  let mirrorCalls = 0;
  const out = await buildMirrorForProspect(
    { business_name: "No TLS Plumbing", industry: "plumbing", city: "Tulsa", state: "OK", logo: "http://notls.example/logo.png" },
    {
      deps: {
        resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
        mirror: async () => { mirrorCalls++; return { status: 200, body: { ok: true } }; },
      },
    },
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, "logo_not_https");
  assert.match(out.detail, /plain http/);
  assert.equal(mirrorCalls, 0);
});

// All Home Plumbing Co. (Chattanooga) had a logo candidate AND seven of its own
// real photographs, and still could not build: its site is http-only, the
// harvester handed the http URLs straight through, and the request failed
// validation on /brand/photos/0..6 — invalid_request, no build, no clue.
//
// The logo below is NOT the URL this case originally used. It was
// allhomeplumbing.com/images/blogger_logo.png, and on 2026-08-06 that asset was
// fetched from the live mirror and looked at: it is Google's orange Blogger "B",
// which this business had shipped as its schema.org Organization logo. Pinning
// it here would have made this test the contract for publishing somebody else's
// mark, so the assertion now uses a mark that is genuinely the client's and the
// Blogger badge gets the refusal it earns, two tests down. The subject of THIS
// test — an http photo must cost the photo, never the build — is unchanged.
test("http-only client photos are dropped, never fatal to the whole build", async () => {
  let seen = null;
  const out = await buildMirrorForProspect(
    { business_name: "All Home Plumbing Co.", industry: "plumbing", city: "Chattanooga", state: "TN", site: "http://www.allhomeplumbing.com/", logo: "https://www.allhomeplumbing.com/images/all-home-plumbing-logo.png" },
    {
      deps: {
        resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
        resolveVerifiedFacts: async () => ({ ok: true, facts: { business_name: "All Home Plumbing Co.", city: "Chattanooga", state: "TN" }, content: {} }),
        harvestClientPhotos: async () => ({
          ok: true,
          photos: [
            { url: "http://www.allhomeplumbing.com/images/job1.jpg" },
            { url: "https://www.allhomeplumbing.com/images/job2.jpg" },
          ],
        }),
        mirror: async (req) => { seen = req; return { status: 200, body: { ok: true, revealable: true, preview_url: "https://x.wss-ai.com/", checks: {} } }; },
      },
    },
  );
  assert.equal(out.ok, true, "the build still happens");
  assert.deepEqual(seen.brand.photos, ["https://www.allhomeplumbing.com/images/job2.jpg"], "only the TLS-served photo travels");
  assert.equal(seen.brand.logo, "https://www.allhomeplumbing.com/images/all-home-plumbing-logo.png");
});

// THE MARK HAS TO BE THEIRS, not merely on their server.
//
// Both of these were live on wss-ai.com on 2026-08-06, both passed every gate,
// and both were reported as proof that branded builds work. They were fetched
// and rendered:
//   · /assets/client-logo.png on the All Home mirror, sha256 79d6232a…, is
//     Google's Blogger icon, from allhomeplumbing.com/images/blogger_logo.png
//   · /assets/client-logo.png on the Simmons mirror, sha256 844aa338…, is
//     Mastercool, Inc.'s registered trademark, from
//     simmonsplumbing.info/wp-content/uploads/2017/03/mastercool-logo10874446.png
// Both sat under the client's own registrable domain, so the ownership check
// could not see anything wrong, and both were then published as that business's
// schema.org Organization logo and used to measure its palette. A contractor
// displaying the brands they install is normal; republishing those brands as the
// contractor's own identity is the thing this codebase forbids outright.
test("a third-party trademark on the client's own domain is refused before a build", async () => {
  const cases = [
    ["All Home Plumbing Co.", "https://www.allhomeplumbing.com/images/blogger_logo.png"],
    ["Simmons Plumbing and Mechanical LLC.", "https://simmonsplumbing.info/wp-content/uploads/2017/03/mastercool-logo10874446.png"],
  ];
  for (const [business_name, logo] of cases) {
    let mirrorCalls = 0;
    const out = await buildMirrorForProspect(
      { business_name, industry: "plumbing", city: "Tulsa", state: "OK", logo },
      {
        deps: {
          resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
          mirror: async () => { mirrorCalls++; return { status: 200, body: { ok: true } }; },
        },
      },
    );
    assert.equal(out.ok, false, `${business_name}: a third-party mark must never build`);
    assert.equal(out.reason, "logo_third_party_mark");
    assert.match(out.detail, /someone else's trademark/);
    assert.equal(mirrorCalls, 0, "and nothing is spent proving it");
  }
});

test("an unknown foreign-domain HTTPS logo without ownership evidence is refused", async () => {
  let mirrorCalls = 0;
  const out = await buildMirrorForProspect(
    {
      business_name: "Acme Plumbing",
      industry: "plumbing",
      city: "Tulsa",
      state: "OK",
      site: "https://acme-plumbing.example/",
      logo: "https://unknown-assets.example/neutral-logo.png",
    },
    {
      deps: {
        resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
        mirror: async () => { mirrorCalls++; return { status: 200, body: { ok: true } }; },
      },
    },
  );

  assert.equal(out.ok, false);
  assert.equal(out.reason, "logo_provenance_failed");
  assert.match(out.detail, /no first-party ownership evidence/);
  assert.equal(mirrorCalls, 0, "a foreign candidate must stop before mirror()");
});

test("the denylist that catches those two marks is the one the ENGINE reads", () => {
  // capture-brand owns the list; brand-assets.js (resolveBrandAssets) and
  // web-brand.js (the miner's candidate finder) both import it. If they ever
  // diverge, the miner admits leads the build will refuse — or worse, the other
  // way round. Asserted against the real filenames, not a paraphrase.
  const { isThirdPartyMark } = require("../lib/capture-brand");
  assert.equal(isThirdPartyMark("www.allhomeplumbing.com/images/blogger_logo.png"), true);
  assert.equal(isThirdPartyMark("simmonsplumbing.info/wp-content/uploads/2017/03/mastercool-logo10874446.png"), true);
  // And it still lets a real client mark through, including one whose path sits
  // in a WordPress uploads folder — "wp-content" is not "wordpress".
  assert.equal(isThirdPartyMark("rimrockplumbing.com/wp-content/uploads/2019/05/rimrock-logo.png"), false);
  assert.equal(isThirdPartyMark("acme-co.s3.amazonaws.com/logo.png"), false);
  // Surnames a real business plausibly trades under are deliberately NOT on the
  // list: refusing them would cost a lead to block a badge.
  for (const name of ["york-plumbing-logo.png", "carrier-brothers-logo.png", "goodman-and-sons-logo.svg"]) {
    assert.equal(isThirdPartyMark(name), false, `${name} is a business name, not a manufacturer badge`);
  }
});

test("a prospect with no logo continues with the frozen wordmark rung", async () => {
  let factsCalls = 0;
  let harvestCalls = 0;
  let mirrorCalls = 0;
  let request = null;
  const out = await buildMirrorForProspect(
    {
      business_name: "No Mark Plumbing",
      industry: "plumbing",
      city: "Tulsa",
      state: "OK",
      site: "https://nomark.example/",
      site_accent: "#0b5cab",
      site_accent_source: "https://nomark.example/",
    },
    {
      deps: {
        resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
        resolveVerifiedFacts: async () => { factsCalls++; return { ok: true, facts: {}, content: {} }; },
        harvestClientPhotos: async () => { harvestCalls++; return { ok: true, photos: [] }; },
        captureFonts: async () => ({ ok: false }),
        resolveSocials: async () => ({ socials: [], refused: [], source: "skipped" }),
        mirror: async (req) => {
          mirrorCalls++;
          request = req;
          return { status: 200, body: { ok: true, revealable: true, preview_url: "https://x.wss-ai.com/", checks: {} } };
        },
      },
      trustLookup: false,
    },
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(mirrorCalls, 1);
  assert.equal(factsCalls, 1);
  assert.equal(harvestCalls, 1);
  assert.equal(request.brand.logo, undefined, "an empty logo must not violate the request schema");
  assert.deepEqual(request.brand.mark, {
    rung: "wordmark",
    value: { type: "wordmark", text: "No Mark Plumbing", color: "#0B5CAB" },
    reason: "no usable image fell to wordmark",
  });
  assert.equal(request.brand.site_accent, "#0B5CAB");
  assert.equal(request.brand.site_accent_source, "https://nomark.example/");
  const { resolveBrandAssets } = require("../lib/mirror-engine/brand-assets");
  const brandOut = await resolveBrandAssets(request.brand);
  assert.equal(brandOut.accent, "#0B5CAB");
  assert.equal(brandOut.mark.rung, "wordmark");
});

test("the logo ladder kill switch restores the resolver no-logo refusal", async () => {
  const envName = "GHOST_AGENCY_LOGO_LADDER_FALLBACK";
  const previous = process.env[envName];
  let mirrorCalls = 0;
  try {
    process.env[envName] = "0";
    const out = await buildMirrorForProspect(
      { business_name: "No Mark Plumbing", industry: "plumbing", city: "Tulsa", state: "OK" },
      {
        deps: {
          resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
          mirror: async () => { mirrorCalls++; return { status: 200, body: { ok: true } }; },
        },
        trustLookup: false,
      },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_verified_logo");
    assert.equal(mirrorCalls, 0);
  } finally {
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
  }
});

// ---------------------------------------------------------------------------
// THE ACCENT THE MINER ALREADY MEASURED has to reach the build too
// ---------------------------------------------------------------------------
// Same shape as the logo defect above, one field over. Just Air LLC (Phoenix)
// was mined with mirror_request.brand.accent = "#0c449a" and accent_source
// pointing at the JPEG it was measured from — ownership-gated by ownsLogo, the
// third-party denylist and a magic-byte sniff. The build threw it away, because
// the accent is deliberately re-measured from the logo bytes; but measureAccent
// decodes PNG in pure JS and shells out to ffmpeg for everything else, and
// ffmpeg is not in the serverless runtime. So a JPEG mark measures null, brand
// comes back accent:"donor-default", and computeRevealable refuses the whole
// mirror as `unbranded` — for a colour sitting on the record.
//
// It travels as a FALLBACK, never an override: brand-assets may only reach for
// it after its own measurement has come back empty.

const JUST_AIR_LOGO = "https://justairllc.com/wp-content/uploads/2026/06/cropped-justair-1.jpg";
const JUST_AIR = Object.freeze({
  prospect_id: "wss-test-just-air-phoenix",
  business_name: "Just Air LLC",
  industry: "hvac",
  city: "Phoenix",
  state: "AZ",
  record: {
    prospect_id: "wss-test-just-air-phoenix",
    business_name: "Just Air LLC",
    industry: "hvac",
    city: "Phoenix",
    state: "AZ",
    build_ready: {
      version: 1,
      brand_evidence: { logo_url: JUST_AIR_LOGO, accent: "#0c449a" },
      mirror_request: {
        slug: "wss-test-just-air-phoenix",
        donor: "hvac-premier",
        facts: { business_name: "Just Air LLC", industry: "hvac", city: "Phoenix", state: "AZ" },
        brand: { logo: JUST_AIR_LOGO, accent: "#0c449a", accent_source: JUST_AIR_LOGO },
      },
    },
  },
});

test("the mined accent survives the contract reader and the dispatch whitelist", async () => {
  // ONE reader for both entry points — the lesson this file already records
  // about the logo, applied to the colour.
  const carried = prospectBuildInput(JUST_AIR, {});
  assert.equal(carried.logo_accent, "#0c449a", "the colour the miner measured");
  assert.equal(carried.logo_accent_source, JUST_AIR_LOGO, "and the file it came from");

  let seen = null;
  await dispatchMirrorLane(carried, {
    buildMirror: async (input) => {
      seen = input;
      return { ok: true, revealable: true, preview_url: "https://x.wss-ai.com/", slug: "x", donor: "hvac-premier" };
    },
  });
  assert.equal(seen.logo_accent, "#0c449a", "the dispatch whitelist dropped it before this fix");
  assert.equal(seen.logo_accent_source, JUST_AIR_LOGO);
});

test("the build hands the miner's colour to the engine as a fallback, never as the accent", async () => {
  let request = null;
  await buildMirrorForProspect(
    {
      business_name: "Just Air LLC", industry: "hvac", city: "Phoenix", state: "AZ",
      current_website: "https://justairllc.com/",
      logo: JUST_AIR_LOGO, logo_accent: "#0c449a", logo_accent_source: JUST_AIR_LOGO,
    },
    {
      deps: {
        resolveBuildableDonor: () => ({ ok: true, donor: "hvac-premier", vertical: "hvac" }),
        resolveVerifiedFacts: async () => ({ ok: false, facts: {}, content: {} }),
        harvestClientPhotos: async () => ({ photos: [] }),
        captureFonts: async () => ({ ok: false }),
        resolveSocials: async () => ({ socials: [], refused: [], source: "skipped" }),
        mirror: async (req) => { request = req; return { status: 200, body: { ok: true, revealable: true, preview_url: "https://x.wss-ai.com/" } }; },
      },
      trustLookup: false,
    },
  );
  assert.equal(request.brand.accent_fallback, "#0c449a");
  assert.equal(request.brand.accent_fallback_source, JUST_AIR_LOGO);
  // The measured-from-the-bytes provenance the owner's palette rule wants is
  // still what the engine will try FIRST — we did not start supplying `accent`.
  assert.equal(request.brand.accent, undefined);
});

test("brand-assets uses the fallback only after its own measurement comes back empty", async () => {
  const { resolveBrandAssets } = require("../lib/mirror-engine/brand-assets");
  // A 1x1 JPEG: real bytes, correct magic number, nothing measureAccent can
  // decode without ffmpeg — the Just Air shape exactly.
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    + "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
    + "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
  try {
    const withFallback = await resolveBrandAssets({
      logo: JUST_AIR_LOGO, accent_fallback: "#0c449a", accent_fallback_source: JUST_AIR_LOGO,
    });
    assert.equal(withFallback.ok, true, JSON.stringify(withFallback.detail || ""));
    assert.equal(withFallback.accent, "#0c449a");
    assert.equal(withFallback.accent_origin, "measured_by_miner_from_same_logo");

    // WITHOUT the fallback this is the refusal that killed the lead.
    const bare = await resolveBrandAssets({ logo: JUST_AIR_LOGO });
    assert.equal(bare.accent, null, "an undecodable mark still measures nothing");
    assert.equal(bare.accent_origin, "unmeasurable");
  } finally {
    global.fetch = originalFetch;
  }
});

test("a fallback accent with no stated source is refused, exactly like a bare accent", () => {
  const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
  const base = {
    slug: "wss-test-x", donor: "hvac-premier",
    facts: { business_name: "Just Air LLC", industry: "hvac", city: "Phoenix", state: "AZ" },
  };
  const out = checkMirrorRequest({ ...base, brand: { logo: JUST_AIR_LOGO, accent_fallback: "#0c449a" } });
  assert.equal(out.ok, false);
  assert.equal(out.body.detail[0].path, "/brand/accent_fallback_source");
});

test("a denylisted third-party file cannot be laundered in through the fallback source", async () => {
  // Ownership of the host is not ownership of the mark. The fallback runs the
  // SAME denylist as logo and accent_source — otherwise it would be a way to
  // reintroduce Mastercool's blue as a client's brand colour.
  const { resolveBrandAssets } = require("../lib/mirror-engine/brand-assets");
  const out = await resolveBrandAssets({
    logo: "https://justairllc.com/wp-content/uploads/ok.png",
    accent_fallback: "#03a1fa",
    accent_fallback_source: "https://justairllc.com/wp-content/uploads/mastercool-logo10874446.png",
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "brand_asset_rejected");
  assert.ok(out.detail.some((d) => d.path === "/brand/accent_fallback_source"), JSON.stringify(out.detail));
});
