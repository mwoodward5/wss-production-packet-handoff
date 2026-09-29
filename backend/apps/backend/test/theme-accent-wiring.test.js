"use strict";

// test/theme-accent-wiring.test.js
//
// THE ACCENT LAW (2026-09-02 render smoke, austin-roofing + fleet audit):
// a client with NO harvested brand palette shipped generic-blue accents
// (hsl 199 89% 48% — a colour that belongs to no customer) over dead-white
// surfaces, while the donor family's own stylesheet carried a warm brick
// --wss-accent all along. Two mechanisms, both fixed and both held here:
//
//   1. FORMAT SPLIT. themeCss writes `--accent` in the spelling the donor
//      spends (hex for the hand-authored families, HSL triplet for shadcn),
//      but the injected islands compose `hsl(var(--wss-a))` — which needs a
//      bare TRIPLET. A hex --accent made every island accent rule invalid at
//      parse and the components rendered accentless. themeCss therefore also
//      writes `--wss-accent-hsl`, unconditionally a triplet, and the islands
//      read it FIRST.
//
//   2. DONOR SEED. When the client has no colour, the palette is built from
//      the DONOR FAMILY'S OWN --wss-accent token (parsed from the shipped
//      CSS by the engine), ahead of vertical research — never generic blue.
//
//   3. WARM LIGHT SURFACES. Light mode is a cream family: surface-alt is a
//      warm tint of the palette hue, not dead #FFFFFF.
//
//   4. UNCONDITIONAL DEFINITIONS (2026-09-03 micro-fix, live-probed on
//      wss-test-kangaroof-round-rock). The full theme sheet is conditional —
//      a contrast-failed palette is refused — but every built page must still
//      DEFINE --wss-accent (hex) and --wss-accent-hsl (triplet), because the
//      polish layers consume them on every build; a page defining neither let
//      mobile-polish's old `var(--wss-accent, #2563eb)` fallback paint
//      primary CTAs Tailwind blue while the islands read warm brick. The
//      engine now ships an accent bootstrap on both skip paths, and the
//      #2563eb fallback is dead fleet-wide.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const theme = require("../lib/mirror-engine/theme");
const { CONTENT_CSS } = require("../lib/mirror-engine/content-inject");
const { galleryCss } = require("../lib/mirror-engine/project-gallery");

const GENERIC_BLUE = "199 89% 48%";

test("the donor family's own accent seeds the palette when the client has none", () => {
  const p = theme.buildPalette({ vertical: "roofing", mode: "light", donorAccent: "#a33427" });
  assert.equal(p.source, "donor_token");
  assert.equal(p.accent, "#A33427");
  assert.ok(p.passes, "donor-seeded palette must clear contrast");
});

test("a client colour still outranks the donor token", () => {
  const p = theme.buildPalette({ vertical: "roofing", mode: "light", accent: "#1B7D9F", donorAccent: "#a33427" });
  assert.equal(p.source, "client_logo");
  assert.equal(p.accent, "#1B7D9F");
});

test("a near-neutral donor token is refused, not trusted", () => {
  const p = theme.buildPalette({ vertical: "electrical", mode: "light", donorAccent: "#111111" });
  assert.equal(p.source, "vertical_research_fallback");
});

test("light-mode surfaces are a warm cream family, not dead white", () => {
  const p = theme.buildPalette({ vertical: "roofing", mode: "light", donorAccent: "#a33427" });
  assert.notEqual(p.surfaceAlt, "#FFFFFF", "surface-alt must carry the palette's warm hue");
  const hsl = theme.hexToHsl(p.surfaceAlt);
  assert.ok(hsl.s > 0, "surface-alt must be tinted, not neutral");
  assert.ok(Math.abs(hsl.h - theme.hexToHsl("#a33427").h) <= 4, "surface-alt follows the accent hue (rounding aside)");
  assert.ok(theme.relativeLuminance(p.surfaceAlt) > 0.8, "cream must stay a light surface");
  assert.ok(p.passes, "ink re-derived against the darker surface must clear contrast");
});

test("themeCss always writes a triplet --wss-accent-hsl beside the --accent assignment", () => {
  const palette = theme.buildThemePair({ vertical: "roofing", mode: "light", donorAccent: "#a33427" });
  const sheet = theme.themeCss({ palette, donorCss: ":root{--wss-accent:#a33427}" });
  assert.match(sheet, /--accent:#A33427/, "the donor-token spelling is hex for this donor");
  const m = sheet.match(/--wss-accent-hsl:([^;}]+)/);
  assert.ok(m, "the unconditional triplet token must ship");
  assert.match(m[1].trim(), /^-?\d+(\.\d+)? \d+% \d+%$/, "must be a bare HSL triplet any hsl(var()) can drink");
  assert.equal(m[1].trim(), theme.hslTriplet("#A33427"));
  assert.ok(!sheet.includes(GENERIC_BLUE), "the theme sheet never carries the generic blue");
});

test("the shadcn spelling is unchanged: wrapped tokens stay triplets", () => {
  const palette = theme.buildThemePair({ vertical: "plumbing", mode: "light", accent: "#1B7D9F" });
  const sheet = theme.themeCss({ palette, donorCss: ":root{--gold:hsl(var(--accent))}" });
  assert.match(sheet, /--accent:-?[\d.]+ \d+% \d+%/, "wrapped token stays a triplet");
});

test("the injected islands read the theme triplet first and never fall back to generic blue", () => {
  assert.match(CONTENT_CSS, /--wss-a:var\(--wss-accent-hsl,var\(--accent,/);
  assert.ok(!CONTENT_CSS.includes(GENERIC_BLUE), "content islands must not carry the generic blue default");
  const gc = galleryCss();
  assert.match(gc, /--wss-a:var\(--wss-accent-hsl,var\(--accent,/);
  assert.ok(!gc.includes(GENERIC_BLUE), "gallery island must not carry the generic blue default");
});

test("no engine emitter still hardcodes the generic blue accent", () => {
  const files = [
    "lib/mirror-engine/content-inject.js",
    "lib/mirror-engine/project-gallery.js",
    "lib/mirror-engine/authority-pages.js",
    "lib/mirror-engine/seasonal.js",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    assert.ok(!src.includes(`var(--accent,${GENERIC_BLUE})`) && !src.includes(`var(--accent, ${GENERIC_BLUE})`),
      `${rel} still emits the generic-blue accent fallback`);
  }
});

test("engine seeds the donor accent from the family's shipped stylesheet", () => {
  const engineSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "engine.js"), "utf8");
  assert.match(engineSrc, /--wss-accent\\s\*:\\s\*/, "the engine must parse the donor's --wss-accent token");
  assert.match(engineSrc, /donorAccent:\s*donorAccentSeed/, "the seed must reach buildThemePair");
  // And the real donor declares it, in the exact shape the engine's regex reads.
  const falconCss = fs.readFileSync(
    path.join(__dirname, "..", "donors-clean", "roofing-falcon-clean", "assets", "style.css"), "utf8");
  const m = falconCss.match(/--wss-accent\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i);
  assert.equal(m && m[1].toUpperCase(), "#A33427");
  const needle = "--wss-accent\\s*:\\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\\b";
  assert.ok(engineSrc.includes(needle), "the engine's donor-accent regex must still exist verbatim");
});

// ---------------------------------------------------------------------------
// THE UNCONDITIONAL HALF (2026-09-03 micro-fix) — the accent pair is defined
// on EVERY built page, and no injected sheet carries a blue literal fallback.
// ---------------------------------------------------------------------------

test("accentBootstrapCss defines hex + triplet + ink from the seeded palette", () => {
  const seeded = theme.buildThemePair({ vertical: "roofing", mode: "dark", donorAccent: "#a33427" });
  const boot = theme.accentBootstrapCss({ palette: seeded });
  assert.match(boot, /--wss-accent:#A33427/, "hex definition present");
  const m = boot.match(/--wss-accent-hsl:([^;}]+)/);
  assert.ok(m, "triplet definition present");
  assert.match(m[1].trim(), /^-?\d+(\.\d+)? \d+% \d+%$/, "triplet is a bare HSL triplet");
  assert.equal(m[1].trim(), theme.hslTriplet("#A33427"));
  assert.match(boot, /--wss-accent-ink:/, "the ink the pair needs ships with it");
  assert.match(boot, /\[data-wss-theme="light"\]:not\(\.dark\)\{/, "the light counterpart scope ships");
  // And for a light-default palette the scopes mirror themeCss's twins.
  const lightBoot = theme.accentBootstrapCss({ palette: theme.buildThemePair({ vertical: "roofing", mode: "light", donorAccent: "#a33427" }) });
  assert.match(lightBoot, /:root:not\(\[data-wss-theme="dark"\]\):not\(\.dark\)\s*\{/, "light main scope");
  assert.match(lightBoot, /\[data-wss-theme="dark"\],:root\.dark\{/, "dark counterpart scope");
});

test("no lib emitter carries the #2563eb blue fallback any more", () => {
  // Files whose remaining mention of 2563eb is NOT an emitted colour: a
  // brand-default DETECTOR (its job is to recognise Tailwind blue as
  // "not a brand"), a self-test's fixture data, a comment, and a
  // colour-NAME parser map. Any other hit fails.
  const NON_EMITTERS = new Set([
    "brand-default-detector.cjs",
    "brand-truth.cjs",
    "outreach-email-v3.js",
    "site-change-plan.js",
  ]);
  const libDir = path.join(__dirname, "..", "lib");
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(js|cjs|mjs)$/.test(e.name)) {
        const src = fs.readFileSync(full, "utf8");
        if (/2563eb/i.test(src) && !NON_EMITTERS.has(e.name)) offenders.push(path.relative(libDir, full));
      }
    }
  };
  walk(libDir);
  assert.deepEqual(offenders, [], `emitters still carrying the Tailwind-blue fallback: ${offenders.join(", ")}`);
  // The mobile CTA floor reads the warm chain, never a blue literal.
  const { mobilePolishCss } = require("../lib/mirror-engine/mobile-polish");
  assert.ok(!/2563eb/i.test(mobilePolishCss()), "mobile CTA floor still carries #2563eb");
  assert.match(mobilePolishCss(), /var\(--wss-accent,\s*#a43828\)/, "mobile CTA floor falls back to the warm brick");
});

// THE BUILT PAGE LAW — a full engine build (no harvested brand: the exact
// donor-token-seeded case the smoke probes) must DEFINE both accent tokens
// somewhere in its shipped bytes, and ship no blue literal anywhere.
process.env.MIRROR_CLIENT_ROOT = process.env.MIRROR_CLIENT_ROOT
  || fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-accent-wiring-"));

test("a full build with no client palette defines --wss-accent AND --wss-accent-hsl, with no blue literal", async () => {
  const { mirror } = require("../lib/mirror-engine/engine");
  const { slugPolicy } = require("../lib/mirror-engine/deploy");
  const { createRegistry } = require("../lib/mirror-engine/build-hash");
  const { siteEditLog } = require("../lib/site-edit-log");
  const captured = { files: null };
  const deps = {
    slugPolicy,
    siteEditLog: (args) => siteEditLog({ ...args, select: async () => ({ ok: true, mode: "live_select", data: [] }) }),
    resolveBrandAssets: async () => ({
      ok: true, logo: null, accent: null, primary: null, hashes: {}, mediaMode: "housed", photos: [], heroVideo: null,
    }),
    readArchivedFile: async () => null,
    withSpaRewrite: (files) => { captured.files = files; return files; },
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
  const res = await mirror({
    slug: "wss-test-accent-wiring-tucson",
    facts: { business_name: "Summit Air", industry: "HVAC", city: "Tucson", state: "AZ", phone: "(520) 555-0142" },
    content: { services: ["AC Repair", "Furnace Repair"] },
  }, { registry: createRegistry(), deps });
  assert.equal(res.status, 200, `build rejected: ${JSON.stringify(res.body).slice(0, 400)}`);
  const files = captured.files || {};
  assert.ok(files["index.html"], "the build shipped an index");
  const everything = Object.entries(files)
    .filter(([rel]) => /\.(html?|css)$/i.test(rel))
    .map(([rel, buf]) => `${rel}\n${buf.toString("utf8")}`)
    .join("\n");
  assert.ok(everything.includes("--wss-accent-hsl:"), "the built page DEFINES the accent triplet");
  assert.ok(/--wss-accent:\s*#/.test(everything), "the built page DEFINES the accent hex");
  assert.ok(everything.includes("--wss-a:var(--wss-accent-hsl,var(--accent,"), "the islands read the chain");
  assert.ok(!/2563eb/i.test(everything), "no Tailwind-blue literal ships in any built byte");
  assert.ok(!everything.includes("199 89% 48%"), "no generic-blue literal ships in any built byte");
});
