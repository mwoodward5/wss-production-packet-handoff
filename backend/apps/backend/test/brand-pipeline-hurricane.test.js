"use strict";

// THE HURRICANE FENCE REGRESSION — four breaks, one fixture.
//
// hurricanefenceinc.com is the measured diagnostic (2026-09): a WordPress site
// that declares `:root { --main: #091e3a; --accent: #e31e24; }` in a plain
// <style> block, carries a real WebP logo (screenshot.webp, 358x81, class
// custom-logo), and wears red #e31e24 as its accent everywhere. The pipeline
// found the logo, classified it header-grade, threw it away because
// measureAccent(bytes, "webp") returned null with no ffmpeg in serverless, fell
// to a wordmark with an EMPTY colour, never read the :root tokens, and rendered
// the cinematic donor dark because the freeze never supplied the brightness
// shares the escape hatch reads. Every break is pinned here, before and after,
// against the site's actual markup. The distilled fixture
// (fixtures/hurricane-fence-distilled.html) carries the head verbatim — the
// white theme-color decoy, the WP preset tokens, the theme's :root block, the
// custom-logo <img> — so the assertions stay deterministic; the FULL captured
// page (fixtures/hurricane-fence.html, committed from the same diagnostic)
// exercises the same extraction in lib/brand-extractor's tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const dns = require("node:dns");

const db = require("../lib/design-brief");
const theme = require("../lib/mirror-engine/theme");
const freeze = require("../lib/line-identity-freeze");
const leadMiner = require("../lib/lead-miner");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures/hurricane-fence-distilled.html"), "utf8");
const SITE_URL = "https://www.hurricanefenceinc.com/";
const LOGO_URL = "https://www.hurricanefenceinc.com/wp-content/uploads/2026/05/screenshot.webp";

// --- a real greyscale PNG at the real mark's dimensions ----------------------
//
// measureAccent decodes PNG in pure JS everywhere, so a GREY mark returns null
// on every machine — developer (with ffmpeg), CI (with ffmpeg) and serverless
// (without). That makes the "logo found but unmeasurable" branch deterministic
// in tests, which a WebP fixture would not be: ffmpeg on the runner would
// happily measure it. 358x81 mirrors screenshot.webp exactly.

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function greyscalePng(width, height, shade = 0x88) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // colour type: greyscale
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, shade)]);
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const GREY_MARK = greyscalePng(358, 81);

// --- stubbing guardedFetch's two dependencies (global fetch + dns.lookup) ----

function withFetchedBytes(bytes, fn) {
  const realFetch = globalThis.fetch;
  const realLookup = dns.lookup;
  globalThis.fetch = async () => new Response(bytes, {
    status: 200,
    headers: { "content-type": "image/png" },
  });
  dns.lookup = (host, opts, cb) => {
    const callback = typeof opts === "function" ? opts : cb;
    callback(null, [{ address: "93.184.216.34", family: 4 }]);
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = realFetch;
      dns.lookup = realLookup;
    });
}

// --- a measured evidence payload shaped like the Hurricane capture -----------
//
// The site's buttons render white/outline: the action-fill shortlist the brief
// used to rely on measures nothing saturated. Only the :root block declares the
// brand.

function hurricaneMeasured(overrides = {}) {
  return {
    viewport: { width: 1280, height: 800 },
    docHeight: 3200,
    title: "Fence Company in Richmond, VA | Quality Fences Since 1994",
    bodySurface: "#FFFFFF",
    rootTokens: {
      "--main": "#091e3a",
      "--accent": "#e31e24",
      "--text": "#4a5568",
    },
    backgrounds: { "#FFFFFF": 800000, "#F8F5F1": 200000, "#091E3A": 60000 },
    textColors: { "#4A5568": 1400 },
    borderColors: { "#EEEEEE": 9 },
    fontStats: { "Barlow": { chars: 1400, maxSize: 44, area: 90000, weights: { "400": 1400 } } },
    actionFills: { "#FFFFFF": { area: 22000, count: 4, labels: ["Get a Free Estimate"] } },
    actionInks: { "#091E3A": { chars: 90, count: 4, labels: ["Get a Free Estimate"] } },
    chromaAreas: { "#FFFFFF": 820000 },
    loudCandidates: [],
    images: [],
    logoCandidates: [],
    visibleText: [
      "Quality Fences Since 1994",
      "Richmond's trusted fence company for residential and commercial fencing.",
      "Wood privacy fences, aluminum ornamental fencing, chain link, and vinyl.",
      "Every installation is backed by our workmanship guarantee and thirty years of experience serving central Virginia.",
      "Family owned and operated since 1994. Licensed and insured. Free on-site estimates across the Richmond metro area.",
      "Our crew installs over five hundred fences a year, and every post is set to spec.",
    ],
    elementCount: 420,
    truncatedElements: false,
    ...overrides,
  };
}

function hurricaneEvidence(overrides = {}) {
  return {
    ok: true,
    version: db.BRIEF_VERSION,
    url: SITE_URL,
    finalUrl: SITE_URL,
    capturedAt: new Date("2026-09-02T12:00:00.000Z").toISOString(),
    measured: hurricaneMeasured(),
    pixelSurface: "",
    pixelShare: 0,
    ...overrides,
  };
}

// ===========================================================================
// BREAK 1 — the header-grade mark the miner cannot decode is not thrown away
// ===========================================================================

test("break 1: the site's declared colour is read from the HTML the miner already holds", () => {
  const got = leadMiner.siteAccentFromHtml(FIXTURE);
  assert.ok(got, "a site declaring --accent must yield a colour");
  assert.equal(got.hex, "#E31E24", "the red the site declares, not a decoy");
  assert.equal(got.source, "css_root_token");
  assert.equal(got.method, "site_css_token(--accent)");
});

test("break 1: the decoys abstain — white meta theme-color and near-black --main are not accents", () => {
  // theme-color #ffffff fails the saturation floor; --main #091e3a fails the
  // luminance band (l ≈ 13%). Only --accent may speak.
  assert.equal(leadMiner.siteAccentFromHtml('<meta name="theme-color" content="#ffffff">'), null);
  assert.equal(leadMiner.parseSiteColor("#091e3a"), "#091E3A");
  const hsl = require("../lib/mirror-engine/theme").hexToHsl("#091E3A");
  assert.ok(hsl.l < 15, "navy #091e3a sits below the accent luminance floor");
});

test("break 1: an unmeasurable header-grade mark ships WITH the logo and a declared fallback colour", async () => {
  await withFetchedBytes(GREY_MARK, async () => {
    const out = await leadMiner.resolveOwnLogo({
      siteUrl: SITE_URL,
      html: FIXTURE,
      businessName: "Hurricane Fence",
    });
    // BEFORE: { ok: false, reason: "accent_unmeasurable" } — the mark was set
    // down and the record fell to a colourless wordmark.
    assert.equal(out.ok, true);
    assert.equal(out.deferredAccent, true);
    assert.equal(out.logo.url, LOGO_URL);
    assert.equal(out.logo.ext, "png");
    assert.equal(out.logo.accent, "", "nothing may claim the colour was measured from the logo");
    assert.equal(out.logo.accent_method, "deferred_to_render_browser(unmeasurable_here:png)");
    assert.equal(out.accentFallback.hex, "#E31E24");
    assert.equal(out.accentFallback.source, SITE_URL);
  });
});

test("break 1: with no declared colour anywhere, the mark is persisted for the render-time brief", async () => {
  // Strip EVERY colour declaration: both style blocks (the theme's :root and
  // WordPress's preset tokens — the latter also matches the --accent pattern),
  // the theme-color meta, and the inline section backgrounds.
  const htmlWithoutColor = FIXTURE
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<meta name="theme-color"[^>]*>/, "")
    .replace(/ style="[^"]*"/g, "");
  await withFetchedBytes(GREY_MARK, async () => {
    const out = await leadMiner.resolveOwnLogo({
      siteUrl: SITE_URL,
      html: htmlWithoutColor,
      businessName: "Hurricane Fence",
    });
    assert.equal(out.ok, false, "no colour anywhere: the ladder wordmark still answers");
    assert.equal(out.reason, "accent_unmeasurable");
    assert.equal(out.pendingLogo.url, LOGO_URL, "the mark's coordinates survive for the freeze");
    assert.equal(out.pendingLogo.reason, "accent_unmeasurable_in_miner");
    assert.equal(out.pendingLogo.ext, "png");
  });
});

// ===========================================================================
// BREAK 2 — the line lane's mirror dispatch carries the colour the miner proved
// ===========================================================================

test("break 2: the deferred brand block clears the mirror-request schema (capability floor)", () => {
  const sha = require("node:crypto").createHash("sha256").update(GREY_MARK).digest("hex");
  // Exactly the shape mineBuildReady now emits into mirrorRequest.brand for a
  // deferred mark — and the shape the webhook lane's brand_colors path already
  // fed mirror-lane-build.
  const verdict = checkMirrorRequest({
    slug: "hurricane-fence-richmond",
    donor: "fencing-sterling",
    facts: { business_name: "Hurricane Fence", industry: "fencing", city: "Richmond", state: "VA" },
    brand: {
      logo: LOGO_URL,
      logo_sha256: sha,
      accent_fallback: "#E31E24",
      accent_fallback_source: SITE_URL,
    },
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.body || verdict).slice(0, 600));
});

test("break 2: a measured accent still rides as THE accent, and the fallback never overrides it", () => {
  // The schema's provenance rule, pinned at the miner boundary: accent and
  // accent_fallback together is valid ONLY because fallback fills holes — the
  // engine still measures the logo first wherever a decoder exists.
  const verdict = checkMirrorRequest({
    slug: "measured-accent-still-wins",
    donor: "fencing-sterling",
    facts: { business_name: "Hurricane Fence", industry: "fencing", city: "Richmond", state: "VA" },
    brand: {
      logo: LOGO_URL,
      logo_sha256: require("node:crypto").createHash("sha256").update(GREY_MARK).digest("hex"),
      accent: "#091E3A",
      accent_source: LOGO_URL,
      accent_fallback: "#E31E24",
      accent_fallback_source: SITE_URL,
    },
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.body || verdict).slice(0, 600));
});

// ===========================================================================
// BREAK 3 — :root custom properties join the accent shortlist
// ===========================================================================

test("break 3: a theme that declares --accent wins the accent even when its buttons measure neutral", () => {
  const brief = db.briefFromMeasurement(hurricaneEvidence());
  // BEFORE: rankAccentCandidates saw a white fill, the floor abstained, and
  // brief.accent was absent — the red in :root was invisible to the brief.
  assert.equal(brief.accent, "#E31E24");
  assert.equal(brief.measurements.accentCandidates[0].role, "root_token");
  assert.equal(brief.measurements.accentCandidates[0].token, "--accent");
  assert.match(brief.provenance.accent.note, /--accent in :root/);
  assert.ok(brief.provenance.accent.confidence >= 0.6, "confident enough to ride as accent_fallback");
});

test("break 3: a near-neutral declared token abstains like a near-neutral button", () => {
  // The full Hurricane condition: nothing saturated is painted anywhere (white
  // buttons, no coloured inks), so the only claim left is a grey --accent.
  const brief = db.briefFromMeasurement(hurricaneEvidence({
    measured: hurricaneMeasured({
      rootTokens: { "--accent": "#333333" },
      actionInks: {},
    }),
  }));
  assert.ok(!/^#[0-9A-F]{6}$/.test(brief.accent || ""), "grey --accent is not a brand colour");
  assert.ok(brief.refusals.some((r) => r.reason === "below_saturation_floor"));
});

test("break 3: declared tokens rank HIGH but a hero-scale painted fill still outranks them", () => {
  const brief = db.briefFromMeasurement(hurricaneEvidence({
    measured: hurricaneMeasured({
      actionFills: { "#0F6FBF": { area: 900000, count: 6, labels: ["Book Now"] } },
    }),
  }));
  assert.equal(brief.accent, "#0F6FBF", "a page that genuinely paints its accent everywhere wins");
  assert.equal(brief.measurements.accentCandidates[0].role, "fill");
});

test("break 3: measureInPage reads the tokens off documentElement", () => {
  // The in-page half runs inside Chromium, which unit tests never launch (the
  // design-brief contract). Pin the contract on the serialised source instead:
  // the computed style of :root must be read and the token list returned.
  const source = String(db.measureInPage);
  assert.match(source, /getComputedStyle\(document\.documentElement\)/);
  for (const token of db.ROOT_ACCENT_TOKENS) {
    assert.ok(source.includes(`"${token}"`), `measureInPage must read ${token}`);
  }
});

// ===========================================================================
// BREAK 4 — the cinematic escape can see a measured-light client
// ===========================================================================

test("break 4: section-area brightness shares are measured into the brief", () => {
  const shares = db.surfaceShares({ "#FFFFFF": 800000, "#F8F5F1": 200000, "#091E3A": 60000 });
  assert.equal(shares.brightShare, 0.94);
  assert.equal(shares.darkShare, 0.06);
  const brief = db.briefFromMeasurement(hurricaneEvidence());
  assert.equal(brief.measurements.brightShare, 0.94);
  assert.equal(brief.measurements.darkShare, 0.06);
});

test("break 4: the freeze carries brightShare/darkShare, so the cinematic escape fires", () => {
  // The shape freezeVisualIdentity hands visualIdentityPatch: a BRIEF, not the
  // raw capture. Hurricane's measured numbers: 94% of painted section area is
  // light, 6% dark.
  const brief = {
    version: db.BRIEF_VERSION,
    url: SITE_URL,
    finalUrl: SITE_URL,
    capturedAt: "2026-09-02T12:00:00.000Z",
    mode: "light",
    surface: "#FFFFFF",
    accent: "#E31E24",
    fontDisplay: "Barlow",
    fontBody: "Barlow",
    fontHref: "https://fonts.googleapis.com/css2?family=Barlow&display=swap",
    measurements: { visibleTextChars: 1400, brightShare: 0.94, darkShare: 0.06 },
    provenance: { accent: { source: "measured", confidence: 0.85, note: "declared in :root" } },
  };
  const patch = freeze.visualIdentityPatch(brief);
  assert.equal(patch.client_surface.mode, "light");
  assert.equal(patch.client_surface.basis, "paper");
  assert.equal(patch.client_surface.brightShare, 0.94, "BEFORE: the share was never provided");
  assert.equal(patch.client_surface.darkShare, 0.06);
  // The share must survive normalisation — the capability floor both lanes read.
  const { surface } = require("../lib/client-surface").normalizeClientSurface(patch.client_surface, { now: Date.parse(brief.capturedAt) });
  assert.ok(surface, `a schema-valid client_surface (${JSON.stringify(require("../lib/client-surface").normalizeClientSurface(patch.client_surface, { now: Date.parse(brief.capturedAt) }))})`);
  assert.equal(surface.brightShare, 0.94);
  // And the escape itself: BEFORE (no shares) decideMode returned dark and
  // fencing-sterling rendered dark for every client, forever.
  const decision = theme.decideMode(surface, { donor: "fencing-sterling" });
  assert.equal(decision.mode, "light");
  assert.match(decision.why, /strongly_measured_light/);
  const before = theme.decideMode({ mode: "light", basis: "paper" }, { donor: "fencing-sterling" });
  assert.equal(before.mode, "dark", "the old shape (no shares) is still, correctly, dark");
});

test("break 4: the freeze re-attaches the mark the miner set down, with the brief's colour", async () => {
  const logoSha = require("node:crypto").createHash("sha256").update(GREY_MARK).digest("hex");
  const request = {
    slug: "hurricane-fence-richmond",
    donor: "fencing-sterling",
    facts: {
      business_name: "Hurricane Fence",
      industry: "fencing",
      current_website: SITE_URL,
      city: "Richmond",
      state: "VA",
    },
    brand: {
      mark: { rung: "wordmark", value: { type: "wordmark", text: "Hurricane Fence", color: "#E31E24" }, reason: "no usable image fell to wordmark" },
    },
  };
  const prospect = {
    prospect_id: "hurricane-fence-richmond",
    updated_at: "2026-09-02T00:00:00.000Z",
    record: {
      brand_evidence: {
        unmeasured_logo: {
          url: LOGO_URL,
          sha256: logoSha,
          ext: "webp",
          mime: "image/webp",
          bytes: GREY_MARK.length,
          reason: "accent_unmeasurable_in_miner",
        },
      },
    },
  };
  const brief = {
    version: db.BRIEF_VERSION,
    url: SITE_URL,
    finalUrl: SITE_URL,
    capturedAt: "2026-09-02T12:00:00.000Z",
    mode: "light",
    surface: "#FFFFFF",
    accent: "#E31E24",
    fontDisplay: "Barlow",
    fontBody: "Barlow",
    fontHref: "https://fonts.googleapis.com/css2?family=Barlow&display=swap",
    measurements: { visibleTextChars: 1400, brightShare: 0.94, darkShare: 0.06 },
    provenance: { accent: { source: "measured", confidence: 0.85, note: "declared in :root" } },
  };
  let persistedRow = null;
  const out = await freeze.freezeVisualIdentity(prospect, request, {
    deadlineAt: Date.now() + 120_000,
    buildDesignBrief: async () => ({ ok: true, brief }),
    conditionalUpdate: async (_table, _key, _id, _cas, row) => {
      persistedRow = row;
      return { ok: true, updated: true };
    },
  });
  assert.equal(out.persisted, true, `reason: ${out.reason}`);
  assert.equal(out.request.brand.logo, LOGO_URL, "BEFORE: the wordmark shipped and the logo stayed discarded");
  assert.equal(out.request.brand.logo_sha256, logoSha);
  assert.equal(out.request.brand.accent_fallback, "#E31E24");
  assert.equal(out.request.brand.accent_fallback_source, SITE_URL);
  assert.equal(out.request.client_surface.brightShare, 0.94);
  assert.ok(persistedRow.record.build_ready.mirror_request.brand.logo === LOGO_URL);
  // And the whole rescued request clears the schema floor.
  const verdict = checkMirrorRequest(out.request);
  assert.equal(verdict.ok, true, JSON.stringify(verdict.body || verdict).slice(0, 600));
});

test("break 4: no confident brief accent — the wordmark is never traded for an unmeasurable logo", async () => {
  const request = {
    slug: "no-accent-case",
    donor: "fencing-sterling",
    facts: { business_name: "Hurricane Fence", current_website: SITE_URL, city: "Richmond", state: "VA" },
    brand: { mark: { rung: "wordmark", value: { type: "wordmark", text: "Hurricane Fence", color: "" }, reason: "x" } },
  };
  const prospect = {
    prospect_id: "no-accent-case",
    updated_at: "2026-09-02T00:00:00.000Z",
    record: { brand_evidence: { unmeasured_logo: { url: LOGO_URL, sha256: "a".repeat(64), ext: "webp", mime: "image/webp", bytes: 100, reason: "accent_unmeasurable_in_miner" } } },
  };
  const patch = freeze.unmeasuredLogoPatch(prospect, {
    finalUrl: SITE_URL,
    accent: "#e31e24",
    provenance: { accent: { source: "measured", confidence: 0.2, note: "weak" } },
  }, request);
  assert.deepEqual(patch, {}, "a weak measurement never rescues a passing wordmark into a failing logo");
});

// ===========================================================================
// BONUS — the donor's gold never reaches a client-red page
// ===========================================================================

test("bonus: fencing-sterling's gold tokens are repointed, in both spellings the donor uses", () => {
  const donorCss = [
    ":root{--background: 30 10% 8%;--primary: 38 80% 55%;--ring: 38 80% 55%;--sidebar-primary: 38 80% 55%;--sidebar-ring: 38 80% 55%;--sidebar-border: 30 8% 20%}",
    ".ring-sidebar-ring{--tw-ring-color: hsl(var(--sidebar-ring))}",
    ".bg-sidebar-primary{background-color: hsl(var(--sidebar-primary))}",
    ".focus-visible\\:ring-ring:focus-visible{--tw-ring-color: hsl(var(--ring))}",
  ].join("\n");
  const palette = theme.buildPalette({ accent: "#E31E24", primary: "#091E3A", vertical: "fencing", mode: "light" });
  const css = theme.themeCss({ palette, donorCss, defaultMode: "light" });
  assert.ok(!css.includes("38 80% 55%"), "no donor gold survives in the override sheet");
  assert.ok(css.includes("--sidebar-primary:358 78% 50%"), "sidebar-primary repointed to the client's red");
  assert.ok(css.includes("--sidebar-ring:358 78% 50%"), "sidebar-ring repointed to the client's red");
  assert.ok(css.includes("--ring:358 78% 50%"), "ring repointed");
});

test("bonus: the donor's hard-coded .text-gradient and ::selection follow the client's accent", () => {
  const donorCss = [
    ".text-gradient{background:linear-gradient(135deg,#e8a530,#f6ce55,#e8a530);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}",
    "::-moz-selection{background:#e8a5304d;color:#efece7}",
    "::selection{background:#e8a5304d;color:#efece7}",
  ].join("\n");
  const palette = theme.buildPalette({ accent: "#E31E24", primary: "#091E3A", vertical: "fencing", mode: "light" });
  const css = theme.themeCss({ palette, donorCss, defaultMode: "light" });
  assert.ok(css.includes(".text-gradient{background-image:linear-gradient(135deg,var(--wss-slab-ink)"), "BEFORE: the gold gradient shipped verbatim");
  assert.ok(!css.includes("e8a530"), "no hard-coded donor gold in the override");
  assert.ok(/::selection\{background-color:color-mix\(in srgb,var\(--wss-accent\)/.test(css), "BEFORE: highlighting text glowed donor gold");
  assert.equal(theme.textGradientSelectors(donorCss).includes(".text-gradient"), true);
  assert.deepEqual(theme.selectionSelectors(donorCss), ["::-moz-selection", "::selection"]);
});

test("bonus: a donor whose gradient already spends variables is left alone", () => {
  const donorCss = ".text-gradient{background-image:linear-gradient(135deg,var(--wss-slab-ink),var(--wss-accent-soft));background-clip:text}";
  assert.deepEqual(theme.textGradientSelectors(donorCss), [], "a repointable reference is not ours to rewrite");
});
