"use strict";

// test/donor-electrical-livewire.test.js — the electrical vertical's first donor.
//
// Ported 2026-08-19 from the owner's Lovable "Electrician Template"
// (voltage-valor-spark), then REBUILT 2026-09-02 as a zero-framework static
// donor by the A+ lane: one hand-authored index.html (real header/main/footer
// markup, slab hero with grid-lines and glow orbs, services grid, numbered
// process, focus tiles, gallery, FAQ accordions, slab CTA band, contact
// rails, mobile action dock), one hand-authored stylesheet on the engine's
// --wss-* custom properties, and one script asset — the hero video layer that
// mounts the ladder-marked <video> (the page is complete without it). This
// file pairs three things that must never drift apart:
//
//   1. THE REGISTRY — "electrical" is an APPROVED_CATEGORY in lib/copilot.js
//      and a canonical vertical in data/donor-verticals.json. Without the
//      copilot entry, mirror-lane-build's approvedIndustry(inferred.trade)
//      returns "" for every electrical lead and the lane refuses the packet —
//      the exact gap that left electrical leads with no donor.
//   2. THE DONOR — engine-resolvable by vertical, manifest name equal to its
//      directory (a drifted name makes the identity gate inert), photo slots
//      that exist and are referenced, and a hero on the documented video
//      ladder with a real WSS fallback clip shipped.
//   3. THE COLLAPSE CONTRACT — every optional token collapses its own UI; a
//      phone-less build carries no dangling tel:/sms: construct (the compiled
//      hrefs are precomputed whole, 'tel:+1' + digits, never welded copy).
//
// The WSS fallback clip is a PLACEHOLDER by owner directive (2026-08-19): a
// copy of the library's vetted trade-neutral gauge close-up, standing in until
// the owner's Veo lane generates a real electrician clip. The manifest note
// records that; this file asserts the note survives so the swap is never
// forgotten.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS_CLEAN = path.join(BACKEND, "donors-clean");
const DONOR = "electrical-livewire";
const DIR = path.join(DONORS_CLEAN, DONOR);

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-livewire-"));

const { loadDonor, resolveDonor, listDonors } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");
const { identityScan } = require("../lib/mirror-engine/scan");
const { approvedIndustry } = require("../lib/copilot");
const { resolveAlias, liveVerticals, loadTable } = require("../lib/donor-verticals");
const { buildableVerticals } = require("../lib/buildable-verticals");
const { VERTICALS } = require("../lib/render-gate");
const { inferTrade } = require("../lib/trade-inference");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));

function bundlePath() {
  const name = fs.readdirSync(path.join(DIR, "assets")).find((f) => /^index-.*\.js$/.test(f));
  assert.ok(name, "no hero layer bundle in assets/");
  return path.join(DIR, "assets", name);
}
const bundleOf = () => fs.readFileSync(bundlePath(), "utf8");

// Static rebuild: the stylesheet is a hand-authored file on --wss-* custom
// properties, not a compiled index-*.css artifact.
const CSS_NAME = "electrical-livewire.css";
const cssOf = () => fs.readFileSync(path.join(DIR, "assets", CSS_NAME), "utf8");

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Copper Crest Electric",
    CITY: "Waco", ADDRESS_CITY: "Waco", STATE: "TX", REGION: "TX",
    HERO_HEADLINE: "Electrician in Waco, TX",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(254) 555-0117", PHONE_DIGITS: "2545550117",
      EMAIL: "hello@example.com", COUNTY: "McLennan County",
      LICENSE: "TX TECL-555001", RATING: "4.8", REVIEW_COUNT: "57",
      PROFILE_URL: "https://maps.google.com/?cid=1",
      HERO_LINE_A: "Copper Crest Electric", HERO_LINE_B: "Electrician in Waco, TX",
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
// 1. THE REGISTRY — the additions that make electrical leads buildable
// ---------------------------------------------------------------------------
test("electrical is an approved industry, by name and by its common labels", () => {
  for (const input of ["electrical", "electrician", "electricians", "electrical contractor",
    "mine 10 electricians in Dallas, TX", "Residential Electrician"]) {
    assert.equal(approvedIndustry(input), "electrical", input);
  }
});

test("inferTrade -> approvedIndustry round-trips for an electrical lead (the mirror-lane-build path)", () => {
  const inferred = inferTrade({
    label: "Electrician",
    services: ["panel upgrade", "ev charger", "rewire"],
    businessName: "Copper Crest Electric",
    siteText: "wiring, breaker and outlet install",
  });
  assert.equal(inferred.trade, "electrical", JSON.stringify(inferred));
  assert.equal(approvedIndustry(inferred.trade), "electrical",
    "approvedIndustry must accept the inferred trade key itself — this is the exact call mirror-lane-build makes");
});

test("the engine resolves the electrical vertical to this donor", () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  delete process.env.MIRROR_DONOR_ROOT;
  try {
    const res = resolveDonor({ industry: "electrical" });
    assert.equal(res.ok, true, JSON.stringify(res.detail || res.error || ""));
    assert.equal(res.name, DONOR);
    assert.ok(liveVerticals().has("electrical"),
      "electrical must be a LIVE vertical the engine owns (the alias table can never shadow it)");
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});

test("the canonical table and the alias table both route to this donor", () => {
  const table = loadTable();
  assert.equal(table.canonical.electrical, DONOR);
  for (const industry of ["electrician", "electricians", "electrical contractor", "electric"]) {
    assert.equal(table.aliases[industry], DONOR, `missing alias ${industry}`);
    const routed = resolveAlias(industry, {});
    // resolveAlias stands down when the industry is itself a live vertical;
    // none of these four are, so each must route.
    assert.ok(routed && routed.donor === DONOR, `${industry} -> ${JSON.stringify(routed)}`);
  }
});

test("the console's buildable-vertical list offers electrical, and the render gate knows its schema", () => {
  const verticals = buildableVerticals({});
  assert.ok(verticals.some((v) => v.vertical === "electrical" && v.donor === DONOR),
    JSON.stringify(verticals.map((v) => v.vertical)));
  assert.equal(VERTICALS.electrical.schema, "Electrician");
});

// ---------------------------------------------------------------------------
// 2. THE DONOR — manifest identity, slots, bundle shape
// ---------------------------------------------------------------------------
test("manifest.name equals the directory name — a drifted name makes the identity gate inert", () => {
  const m = manifest();
  assert.equal(m.name, DONOR);
  assert.equal(m.vertical, "electrical");
  const listed = listDonors().find((d) => d.name === DONOR);
  assert.ok(listed, "listDonors must surface the donor under its directory name");
});

test("every declared photo slot exists on disk AND is referenced by the shipped output", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = bundleOf();
  assert.ok(Array.isArray(m.photo_slots) && m.photo_slots.length >= 5, "photo slots must be a real flat array");
  for (const slot of m.photo_slots) {
    assert.ok(fs.existsSync(path.join(DIR, slot)), `${slot} missing from the dist`);
    // Static rebuild: slots are referenced by the hand-authored page (gallery
    // figures, hero poster img) or by the hero layer's poster constant —
    // not by a compiled React bundle.
    assert.ok(html.includes(slot) || js.includes(slot),
      `${slot} declared but never referenced by the shipped page or hero layer`);
  }
});

test("the bundle is ONE self-contained script: no ESM syntax, every token a whole quoted literal", () => {
  const js = bundleOf();
  const ESM = /(^|[;}])(import|export)[{ ]|import\.meta|import\(/;
  assert.equal(ESM.test(js), false, "ESM syntax in a plain .js chunk is the serve-time 'exports is not defined' class");
  const jsFiles = fs.readdirSync(path.join(DIR, "assets")).filter((f) => f.endsWith(".js") || f.endsWith(".js.raw"));
  assert.equal(jsFiles.length, 1, `expected one script asset, found: ${jsFiles.join(", ")}`);
  for (const m of js.matchAll(/\{\{[A-Z_]+\}\}/g)) {
    const prev = js[m.index - 1];
    const next = js[m.index + m[0].length];
    assert.equal(prev + next, '""',
      `${m[0]} is welded to literal copy — the facts.ts Record failed to stop constant folding: ${js.slice(m.index - 40, m.index + 40)}`);
  }
});

test("the static stylesheet rides --wss-* custom properties with achromatic literals only", () => {
  const styles = cssOf();
  // PALETTE LAW: the engine owns every color. :root declares achromatic
  // stand-ins the engine palette replaces wholesale, and every rule consumes
  // the property — never a hardcoded brand hue.
  assert.match(styles, /--wss-surface:\s*#fff/, ":root must declare the achromatic stand-ins");
  assert.match(styles, /--wss-slab:\s*#111/);
  assert.match(styles, /--wss-accent:\s*#111/);
  assert.match(styles, /background:\s*var\(--wss-surface,/, "rules must consume the --wss-* properties");
  assert.match(styles, /var\(--wss-accent,/);
  for (const hex of styles.match(/#[0-9a-f]{3,6}\b/gi) || []) {
    const h = hex.slice(1);
    const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const channels = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
    assert.ok(channels[0] === channels[1] && channels[1] === channels[2],
      `${hex} is a chromatic literal — the palette is engine-owned, only achromatic neutrals may appear`);
  }
  // CDN ban (static rebuild): the system stack carries the type; no web-font
  // imports anywhere.
  assert.match(styles, /font-family:\s*system-ui/);
  assert.doesNotMatch(styles, /@import|Oswald|Inter\b/);
});

// ---------------------------------------------------------------------------
// 3. THE HERO VIDEO CONTRACT — ladder island, marked video, shipped fallback
// ---------------------------------------------------------------------------
test("the hero ships the video-first contract: marked mount bundle, ladder island, walker, kill-switch, poster = slot 0", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = bundleOf();

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.equal(m.no_hero_video, undefined, "the owner rejected the no-hero-video contract");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 4);

  // Static rebuild: the hero <video> is MOUNTED by the hero layer bundle —
  // marked data-hero-video, hidden, poster photograph as poster, no static
  // src — directly above the static poster <img> that IS the complete
  // zero-JS hero. The h1 is the engine-composed client headline.
  assert.match(html, /<h1 class="hero-title">\{\{HERO_HEADLINE\}\}<\/h1>/,
    "the hero h1 must be the engine-composed headline, never a baked donor sentence");
  const at = js.indexOf('"data-hero-video"');
  assert.ok(at >= 0, "no marked hero video in the mount bundle");
  const frag = js.slice(at - 60, at + 430);
  for (const attr of ["muted:!0", "loop:!0", "playsInline:!0", 'preload:"none"', "hidden:!0"]) {
    assert.ok(frag.includes(attr), `the mounted hero video must carry ${attr} (has: ${frag})`);
  }
  assert.ok(!/"src":"[^"]*\.mp4"/.test(frag), "a static src is a guaranteed 404 until a clip ships");
  assert.ok(!frag.includes("onError"), "an onError flip would strand the ladder after one failed rung");
  assert.ok(js.includes(`"${m.hero_video.poster}"`),
    `the poster constant must resolve to ${m.hero_video.poster}`);
  assert.match(js, /prefers-reduced-motion:\s*reduce/,
    "the mount layer's own reduced-motion guard decides whether the video mounts at all");
  assert.equal(m.photo_slots[0], m.hero_video.poster);

  // The ladder island is data, client rung first; the universal walker
  // runtime in the shell arms the first rung whose bytes shipped.
  const ladder = ladderOf(html);
  assert.ok(ladder && Array.isArray(ladder.sources), "hero-video-ladder island must parse");
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path]);
  assert.match(html, /heroRungs/, "the universal hero-video walker ships in the shell");
  assert.match(html, /getElementById\("hero-video-ladder"\)/);
  // The kill-switch and the paint-under surface: hidden means hidden, a dead
  // clip is removed outright, and the poster photographs beneath any frame.
  assert.match(html, /video\[data-hero-video\]\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/);
  assert.match(html, /video\[data-hero-video\]\[data-hero-dead\]\s*\{\s*display:\s*none !important;\s*\}/);
  assert.ok(html.includes("data-wss-hero-fallback"), "the paint-under fallback style block ships");
  assert.match(html, /prefers-reduced-motion:\s*reduce/, "reduced motion never arms the clip");
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
    "the manifest must keep saying the clip is a placeholder until the Veo-generated electrician clip replaces it");
  const { files } = loadDonor(DIR);
  assert.ok(files[m.hero_video.wss_fallback_clip_path], "loadDonor ships the clip on every build");
});

test("verified stats render their exact values on first paint — no-JS sees the real numbers, blanks see nothing", () => {
  // Static rebuild: the CTA band's count-ups animate FROM the literal in the
  // markup, so the verified values are what crawlers and no-JS visitors read.
  const full = hydrateFiles({ optional: true });
  const fullHtml = full["index.html"].toString("utf8");
  assert.match(fullHtml, /<strong data-countup data-target="4\.8" data-decimals="1">4\.8<\/strong>/,
    "the verified rating must land literally in the stat, not arrive by script");
  assert.match(fullHtml, /data-countup data-target="57">57<\/strong>/,
    "the verified review count must land literally too");
  // And the DOM-sourced counter counts what actually shipped, not a claim.
  assert.match(fullHtml, /data-count-from="#services \.svc"/, "the service-line count is counted from the page itself");

  const bare = hydrateFiles({ optional: false })["index.html"].toString("utf8");
  assert.ok(!bare.includes('data-target="4.8"'), "an unverified rating must collapse the whole stat");
  assert.ok(!bare.includes('data-target="57"'), "an unverified review count must collapse the whole stat");
});

// ---------------------------------------------------------------------------
// 4. HYDRATION AND COLLAPSE — zero residue, and blanks remove whole constructs
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
  assert.ok(full.includes("2545550117"), "a verified phone must produce a dialable number");
  assert.ok(full.includes("(254) 555-0117"), "the display-form number must still appear");
});

test("the identity gate is armed with the real source atoms and passes clean output", () => {
  const m = manifest();
  // Real needles: the gate must be able to find the source business if it ever
  // resurfaces...
  assert.equal(m.donor_business_name, "Voltage & Valor Electric");
  assert.ok(m.account_ids.includes("EC13016160"), "the excised license number must stay declared");
  const dirty = identityScan(
    { "index.html": Buffer.from("<html><body>Voltage & Valor Electric of Melbourne</body></html>") },
    m,
  );
  assert.equal(dirty.clean, false, "the scan must catch the source business name — otherwise the atoms are inert");
  // ...and the shipped, hydrated tree must be clean under those same atoms.
  const scan = identityScan(hydrateFiles({ optional: true }), m);
  assert.equal(scan.clean, true,
    scan.clean ? "" : `identity residue: ${JSON.stringify((scan.hits || []).slice(0, 6))}`);
});

// ---------------------------------------------------------------------------
// 5. END TO END — an electrical prospect builds (the whole point of the lane)
// ---------------------------------------------------------------------------
test("mirror() builds an electrical prospect end to end (dry run), with and without a phone", async () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  process.env.MIRROR_DONOR_ROOT = DONORS_CLEAN;
  try {
    const base = {
      business_name: "Copper Crest Electric",
      industry: "electrical",
      city: "Waco",
      state: "TX",
    };
    const withPhone = await mirror(
      { slug: "wss-test-copper-crest-electric", facts: { ...base, phone: "(254) 555-0117" } },
      { dryRun: true, registry: createRegistry() },
    );
    assert.equal(withPhone.status, 200, `electrical build rejected: ${JSON.stringify(withPhone.body).slice(0, 500)}`);
    assert.equal(withPhone.body.donor, DONOR);

    const noPhone = await mirror(
      { slug: "wss-test-copper-crest-nophone", facts: { ...base, email: "hello@example.com" } },
      { dryRun: true, registry: createRegistry() },
    );
    assert.equal(noPhone.status, 200, `phone-less electrical build rejected: ${JSON.stringify(noPhone.body).slice(0, 500)}`);
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});
