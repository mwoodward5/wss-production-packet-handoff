"use strict";

// test/donor-realestate-waterline.test.js — the real-estate vertical's first
// donor, and the whole lane that admits it.
//
// Ported 2026-08-20 from the owner's Lovable "wss-donor-realestate-waterline"
// (id 1546dbe3, read file-by-file over the MCP — no remix, no credits) as a
// single-bundle client SPA, clean-room sanitized at source. This file pairs
// the pieces that landed together and must never drift apart — the
// donor-electrical-livewire.test.js shape plus the donor-general-contractor-
// lane.test.js gate half:
//
//   1. THE REGISTRY — "real estate agent" became an APPROVED_CATEGORY in
//      lib/copilot.js, a TRADE_TERMS entry in lib/trade-inference.js, a
//      canonical vertical in data/donor-verticals.json and a render-gate
//      VERTICALS entry (schema RealEstateAgent, exclusive:[] — the GC
//      precedent: realty terms prove our language, they convict nobody).
//      Deliberate NON-alias: bare "real estate" is absent from the copilot
//      entry because approvedIndustry substring-matches longest-first and it
//      would misroute "real estate attorney" leads to the realty donor.
//   2. THE DONOR — engine-resolvable by vertical, manifest name equal to its
//      directory, photo slots that exist and are referenced, the hero on the
//      documented video ladder with a real WSS fallback clip shipped.
//   3. THE COLLAPSE + ISLAND CONTRACT — every optional token collapses its
//      own UI; reviews are island-only (the source design's three fabricated
//      testimonials are gone, with the invented names declared as atoms).
//
// The WSS fallback clip is a PLACEHOLDER by the electrical-livewire
// precedent: a byte-copy of the library's vetted trade-neutral clip, standing
// in until the owner's Veo lane generates a real waterfront clip. The
// manifest note records that; this file asserts the note survives.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS_CLEAN = path.join(BACKEND, "donors-clean");
const DONOR = "realestate-waterline";
const VERTICAL = "real estate agent";
const DIR = path.join(DONORS_CLEAN, DONOR);

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-waterline-"));

const { loadDonor, resolveDonor, listDonors } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");
const { identityScan } = require("../lib/mirror-engine/scan");
const { approvedIndustry } = require("../lib/copilot");
const { resolveAlias, liveVerticals, loadTable } = require("../lib/donor-verticals");
const { buildableVerticals } = require("../lib/buildable-verticals");
const { VERTICALS, checkVertical, evaluateRenderGate } = require("../lib/render-gate");
const { inferTrade } = require("../lib/trade-inference");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));

function bundlePath() {
  const name = fs.readdirSync(path.join(DIR, "assets")).find((f) => /^index-.*\.js$/.test(f));
  assert.ok(name, "no compiled bundle in assets/");
  return path.join(DIR, "assets", name);
}
const bundleOf = () => fs.readFileSync(bundlePath(), "utf8");

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Harbor Line Realty",
    CITY: "Sarasota", ADDRESS_CITY: "Sarasota", STATE: "FL", REGION: "FL",
    HERO_HEADLINE: "Real Estate Agent in Sarasota, FL",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(941) 555-0163", PHONE_DIGITS: "9415550163",
      EMAIL: "hello@example.com", COUNTY: "Sarasota County",
      LICENSE: "FL Lic. SL5550001", RATING: "4.9", REVIEW_COUNT: "38",
      PROFILE_URL: "https://maps.google.com/?cid=1",
      HERO_LINE_A: "Harbor Line Realty", HERO_LINE_B: "Real Estate in Sarasota, FL",
      HERO_LINE_C: "Rated 4.9 stars by 38 clients",
    });
  }
  return tv;
}

function hydrateFiles(opts) {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor(opts) });
  assert.equal(out.ok, true, `hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 400)}`);
  return out.files;
}

function ladderOf(html) {
  const m = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ---------------------------------------------------------------------------
// 1. THE REGISTRY — the additions that make real-estate leads buildable
// ---------------------------------------------------------------------------
test("real estate is an approved industry, by name and by its common labels", () => {
  for (const input of [VERTICAL, "realtor", "realtors", "real estate agency", "real estate broker",
    "realty", "mine 10 realtors in Tampa, FL", "Luxury Realtor"]) {
    assert.equal(approvedIndustry(input), VERTICAL, input);
  }
});

test("the deliberate non-alias: adjacent professions are NOT swallowed by the realty entry", () => {
  // approvedIndustry substring-matches longest-alias-first. Bare "real estate"
  // (11 chars) would beat "attorney" (8) on a real-estate attorney lead, which
  // is why the copilot entry does not claim it. These leads must keep routing
  // to their own professions.
  assert.equal(approvedIndustry("real estate attorney"), "attorney");
  assert.equal(approvedIndustry("real estate photographer"), "photographer");
});

test("inferTrade -> approvedIndustry round-trips for a realty lead (the mirror-lane-build path)", () => {
  const inferred = inferTrade({
    label: "Real Estate",
    services: ["buyer representation", "seller representation", "relocation services", "home valuation"],
    businessName: "Harbor Line Realty",
    siteText: "homes for sale, open house schedule, listing agent",
  });
  assert.equal(inferred.trade, VERTICAL, JSON.stringify(inferred));
  assert.equal(approvedIndustry(inferred.trade), VERTICAL,
    "approvedIndustry must accept the inferred trade key itself — this is the exact call mirror-lane-build makes");
});

test("the engine resolves the real-estate vertical to this donor", () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  delete process.env.MIRROR_DONOR_ROOT;
  try {
    const res = resolveDonor({ industry: VERTICAL });
    assert.equal(res.ok, true, JSON.stringify(res.detail || res.error || ""));
    assert.equal(res.name, DONOR);
    assert.ok(liveVerticals().has(VERTICAL),
      "real estate agent must be a LIVE vertical the engine owns (the alias table can never shadow it)");
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});

test("the canonical table and the alias table both route to this donor", () => {
  const table = loadTable();
  assert.equal(table.canonical[VERTICAL], DONOR);
  for (const industry of ["realtor", "realtors", "real estate", "real estate agency", "real estate broker", "realty"]) {
    assert.equal(table.aliases[industry], DONOR, `missing alias ${industry}`);
    const routed = resolveAlias(industry, {});
    // resolveAlias stands down when the industry is itself a live vertical;
    // none of these six are, so each must route.
    assert.ok(routed && routed.donor === DONOR, `${industry} -> ${JSON.stringify(routed)}`);
  }
});

test("the console's buildable-vertical list offers real estate, and the render gate knows its schema", () => {
  const verticals = buildableVerticals({});
  assert.ok(verticals.some((v) => v.vertical === VERTICAL && v.donor === DONOR),
    JSON.stringify(verticals.map((v) => v.vertical)));
  assert.equal(VERTICALS[VERTICAL].schema, "RealEstateAgent");
  assert.deepEqual(VERTICALS[VERTICAL].exclusive, [],
    "realty terms appear in other trades' honest prose — the entry must convict nobody (the GC precedent)");
});

// ---------------------------------------------------------------------------
// 2. THE RENDER-GATE LANE — the donor-general-contractor-lane.test.js half
// ---------------------------------------------------------------------------
test("a realty mirror printing its own language passes the vertical gate", () => {
  const text = "Harbor Line Realty. Real estate agent in Sarasota, FL. Buyer advisory, seller representation, listing strategy, relocation support and market analysis for the Sarasota area.";
  const verdict = checkVertical(
    { ok: true, title: "Real Estate Agent in Sarasota, FL | Harbor Line Realty", innerText: text, donorText: text },
    { business_name: "Harbor Line Realty", vertical: VERTICAL, services: ["Buyer Advisory", "Seller Representation"] },
  );
  assert.equal(verdict.pass, true, JSON.stringify(verdict).slice(0, 240));
});

test("the new entry convicts a swapped foreign page and is itself refused elsewhere — no loosening", () => {
  // A realty mirror whose donor surface carries another trade's language still fails.
  const swapped = "Harbor Line Realty. Real estate agent in Sarasota, FL. Buyer advisory and listing strategy. Furnace repair and heat pump installation with full duct replacement.";
  const verdict = checkVertical(
    { ok: true, title: "Real Estate Agent in Sarasota, FL | Harbor Line Realty", innerText: swapped, donorText: swapped },
    { business_name: "Harbor Line Realty", vertical: VERTICAL, services: ["Buyer Advisory"] },
  );
  assert.equal(verdict.pass, false, "foreign hvac copy on a realty mirror must still convict");
  // And the realty terms are NOT exclusive: a GC page honestly saying it works
  // with "buyers" of new homes is not convicted as a swapped realty page.
  const gc = "Krab Construction. General contractor in Newport Beach, CA. Kitchen and bathroom remodels, home additions and new construction — trusted by home buyers and sellers preparing a listing.";
  const gcVerdict = checkVertical(
    { ok: true, title: "Krab Construction | General Contractor in Newport Beach, CA", innerText: gc, donorText: gc },
    { business_name: "Krab Construction", vertical: "general contractor", services: ["Kitchen Remodels"] },
  );
  assert.equal(gcVerdict.pass, true, `realty terms must not convict a neighbour: ${JSON.stringify(gcVerdict).slice(0, 200)}`);
});

test("the whole gate still refuses an unapproved vertical — the door opened for realty, not for everyone", () => {
  const verdict = evaluateRenderGate({
    dom: { ok: true, title: "X", innerText: "x", donorText: "x" },
    source: { vertical: "property management", business_name: "X" },
  });
  assert.equal(verdict.pass, false);
});

// ---------------------------------------------------------------------------
// 3. THE DONOR — manifest identity, slots, bundle shape
// ---------------------------------------------------------------------------
test("manifest.name equals the directory name — a drifted name makes the identity gate inert", () => {
  const m = manifest();
  assert.equal(m.name, DONOR);
  assert.equal(m.vertical, VERTICAL);
  const listed = listDonors().find((d) => d.name === DONOR);
  assert.ok(listed, "listDonors must surface the donor under its directory name");
});

test("every declared photo slot exists on disk AND is referenced by the compiled output", () => {
  const m = manifest();
  const js = bundleOf();
  assert.ok(Array.isArray(m.photo_slots) && m.photo_slots.length >= 5, "photo slots must be a real flat array");
  for (const slot of m.photo_slots) {
    assert.ok(fs.existsSync(path.join(DIR, slot)), `${slot} missing from the dist`);
    assert.ok(js.includes(`/${slot}`), `${slot} declared but never referenced by the bundle`);
  }
});

test("the bundle is ONE self-contained script: no ESM syntax, every token a whole quoted literal", () => {
  const js = bundleOf();
  const ESM = /(^|[;}])(import|export)[{ ]|import\.meta|import\(/;
  assert.equal(ESM.test(js), false, "ESM syntax in a plain .js chunk is the serve-time 'exports is not defined' class");
  const jsFiles = fs.readdirSync(path.join(DIR, "assets")).filter((f) => f.endsWith(".js") || f.endsWith(".js.raw"));
  assert.equal(jsFiles.length, 1, `expected one bundle, found: ${jsFiles.join(", ")}`);
  for (const m of js.matchAll(/\{\{[A-Z_]+\}\}/g)) {
    const prev = js[m.index - 1];
    const next = js[m.index + m[0].length];
    assert.equal(prev + next, '""',
      `${m[0]} is welded to literal copy — the facts.ts Record failed to stop constant folding: ${js.slice(m.index - 40, m.index + 40)}`);
  }
});

// ---------------------------------------------------------------------------
// 4. THE HERO VIDEO CONTRACT — ladder island, marked video, shipped fallback
// ---------------------------------------------------------------------------
test("the hero ships the video-first contract: marked <video>, full autoplay set, no static src, poster = slot 0", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = bundleOf();

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.equal(m.no_hero_video, undefined, "the owner rejected the no-hero-video contract");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 4);

  // The video jsx carries a style object with parens inside, so the element is
  // located by index and judged on a bounded slice rather than a [^)]* regex.
  const vidIdx = js.indexOf('jsx("video",{');
  assert.ok(vidIdx > -1, "no compiled hero video element");
  const video = js.slice(vidIdx, vidIdx + 600);
  assert.ok(video.includes('"data-hero-video":!0'), "the ladder runtime has nothing to arm without the marker");
  for (const attr of ["autoPlay:!0", "muted:!0", "loop:!0", "playsInline:!0", 'preload:"metadata"', "hidden:!0"]) {
    assert.ok(video.includes(attr), `hero video must carry ${attr} (has: ${video.slice(0, 300)})`);
  }
  assert.ok(!/\bsrc:/.test(video.slice(0, video.indexOf("style:"))), "a static src is a guaranteed 404 until a clip ships");
  assert.ok(!video.includes("onError"), "an onError flip would strand the ladder after one failed rung");

  // The poster variable resolves to the declared poster, the img branch paints
  // the same file, and the poster is photo slot 0.
  const posterVar = (video.match(/poster:([A-Za-z_$][\w$]*)/) || [])[1];
  assert.ok(posterVar, "poster must ride a shared variable");
  assert.ok(js.includes(`${posterVar}="/${m.hero_video.poster}"`),
    `poster variable must resolve to /${m.hero_video.poster}`);
  assert.ok(new RegExp(`jsx\\("img",\\{src:${posterVar.replace(/\$/g, "\\$")}\\b`).test(js),
    "the img branch must keep painting the still under the dormant video");
  assert.equal(m.photo_slots[0], m.hero_video.poster);

  // The ladder island is data, client rung first; the runtime walk is guarded.
  const ladder = ladderOf(html);
  assert.ok(ladder && Array.isArray(ladder.sources), "hero-video-ladder island must parse");
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path]);
  assert.match(html, /getElementById\("hero-video-ladder"\)/);
  assert.match(html, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /video\[data-hero-video\]/);
  assert.match(js, /prefers-reduced-motion:\s*reduce/,
    "the component's own reduced-motion guard decides whether the video mounts at all");
});

test("the WSS fallback rung ships real mp4 bytes; the client rung stays honestly empty; the Veo swap is on record", () => {
  const m = manifest();
  assert.ok(!fs.existsSync(path.join(DIR, m.hero_video.client_video_path)),
    "the client rung must stay empty until the engine places a verified client clip");
  const clip = path.join(DIR, m.hero_video.wss_fallback_clip_path);
  assert.ok(fs.existsSync(clip), "the WSS fallback clip must ship");
  const bytes = fs.readFileSync(clip);
  assert.ok(bytes.length > 100000, `real clip bytes expected (${bytes.length})`);
  assert.equal(bytes.slice(4, 8).toString("ascii"), "ftyp", "must be a real mp4");
  assert.match(m.hero_video.note, /PLACEHOLDER/,
    "the manifest must keep saying the clip is a placeholder until a real waterfront clip replaces it");
  const { files } = loadDonor(DIR);
  assert.ok(files[m.hero_video.wss_fallback_clip_path], "loadDonor ships the clip on every build");
});

// ---------------------------------------------------------------------------
// 5. HYDRATION AND COLLAPSE — zero residue, and blanks remove whole constructs
// ---------------------------------------------------------------------------
test("hydration leaves zero token or marker residue, optionals present or ALL blank", () => {
  for (const optional of [true, false]) {
    const files = hydrateFiles({ optional });
    for (const [rel, buf] of Object.entries(files)) {
      if (!/\.(html|js|css|json|txt|xml|svg|webmanifest)$/i.test(rel)) continue;
      const s = buf.toString("utf8");
      assert.equal((s.match(/\{\{[A-Z_]+\}\}/g) || []).length, 0, `${rel}: raw token (optional=${optional})`);
      assert.equal(/\[\[NEED:|\[\[\/NEED\]\]/.test(s), false, `${rel}: marker residue (optional=${optional})`);
    }
  }
});

test("a phone-less build carries no dialable construct; a phone-bearing build carries the whole number", () => {
  const blank = hydrateFiles({ optional: false });
  const all = (files) => Object.entries(files)
    .filter(([rel]) => /\.(html|js)$/i.test(rel))
    .map(([, buf]) => buf.toString("utf8")).join("\n");
  const blankAll = all(blank);
  assert.equal(/href\s*[:=]\s*(["'`])(?:tel|sms):\1/.test(blankAll), false, "empty tel/sms href");
  assert.equal(/["'`]\+1["'`]/.test(blankAll), false, "a bare '+1' is a phone that lost its digits");
  const full = all(hydrateFiles({ optional: true }));
  assert.ok(full.includes("9415550163"), "a verified phone must produce a dialable number");
  assert.ok(full.includes("(941) 555-0163"), "the display-form number must still appear");
});

// ---------------------------------------------------------------------------
// 6. TRUTH LAW — island-only reviews, no fabricated identity in the bytes
// ---------------------------------------------------------------------------
test("no fabricated testimonial, prestige metric or platform claim survives in the bundle", () => {
  const js = bundleOf();
  // The source design's invented reviewer names, fabricated counters and
  // third-party platform claims — none may exist in the shipped bytes.
  for (const banned of ["Hartwell", "Castellano", "Beaumont", "Renobeast", "Renocarmen",
    "Portfolio Value", "Years of Expertise", "JRE", "prestigemiami", "Chad Carroll",
    "Miami", "Brickell", "Coconut Grove", "Key Biscayne", "Fisher Island", "Coral Gables"]) {
    assert.equal(js.includes(banned), false, `"${banned}" survived into the compiled bundle`);
  }
  // The reviewer-face gate: only a googleusercontent URL may render as a face.
  // (In the compiled bundle the dot rides the regex literal's backslash.)
  assert.match(js, /googleusercontent/, "the verified-face gate must be compiled in");
  // The island is the only quote source: the bridge global is consumed.
  assert.match(js, /__WSS_CONTENT__/, "the content bridge must be compiled in");
});

test("the identity gate is armed with the real source atoms and passes clean output", () => {
  const m = manifest();
  // Real needles: the gate must be able to find the source concept if it ever
  // resurfaces...
  assert.equal(m.donor_business_name, "JRE Realty");
  assert.ok(m.socials.includes("Renobeast"), "the excised platform claims must stay declared");
  assert.ok(m.persons.includes("Chad Carroll"), "the inspiration-site principal must stay a person atom");
  const dirty = identityScan(
    { "index.html": Buffer.from("<html><body>JRE Realty — waterfront homes in Coconut Grove and Brickell</body></html>") },
    m,
  );
  assert.equal(dirty.clean, false, "the scan must catch the source identity — otherwise the atoms are inert");
  // ...and the shipped, hydrated tree must be clean under those same atoms.
  const scan = identityScan(hydrateFiles({ optional: true }), m);
  assert.equal(scan.clean, true,
    scan.clean ? "" : `identity residue: ${JSON.stringify((scan.hits || []).slice(0, 6))}`);
});

// ---------------------------------------------------------------------------
// 7. END TO END — a realty prospect builds (the whole point of the lane)
// ---------------------------------------------------------------------------
test("mirror() builds a realty prospect end to end (dry run), with and without a phone", async () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  process.env.MIRROR_DONOR_ROOT = DONORS_CLEAN;
  try {
    const base = {
      business_name: "Harbor Line Realty",
      industry: VERTICAL,
      city: "Sarasota",
      state: "FL",
    };
    const withPhone = await mirror(
      { slug: "wss-test-harbor-line-realty", facts: { ...base, phone: "(941) 555-0163" } },
      { dryRun: true, registry: createRegistry() },
    );
    assert.equal(withPhone.status, 200, `realty build rejected: ${JSON.stringify(withPhone.body).slice(0, 500)}`);
    assert.equal(withPhone.body.donor, DONOR);

    const noPhone = await mirror(
      { slug: "wss-test-harbor-line-nophone", facts: { ...base, email: "hello@example.com" } },
      { dryRun: true, registry: createRegistry() },
    );
    assert.equal(noPhone.status, 200, `phone-less realty build rejected: ${JSON.stringify(noPhone.body).slice(0, 500)}`);
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});
