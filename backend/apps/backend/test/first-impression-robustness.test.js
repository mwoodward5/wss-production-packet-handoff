"use strict";

// test/first-impression-robustness.test.js — THE FIRST-SECOND LAW.
//
// (2026-09-04 first-impression robustness lane.) Owner bar: every site looks
// and works like a $10,000 website — including the FIRST SECOND on a cold
// cache. Three proven defects, three laws, asserted at the same level the
// defects live at:
//
//   LAW 1 — NEVER-HIDDEN CONTENT. Sections may not ship opacity:0 (or any
//      hidden state) as their PRE-JS state. The reveal entrance is
//      progressive enhancement: visible by default; JS arms the hidden
//      state (per-element .reveal-armed under the html.js-reveal-armed root
//      gate) immediately BEFORE observing; the engine injects a failsafe
//      net (CSS floor + noscript + a one-shot 900ms force-reveal) under
//      every compiled page that names a .reveal system. A visitor whose JS
//      never runs — or dies to an extension, a smooth-scroll interrupt, a
//      font-metric anomaly, any hiccup — sees the whole page, never a raw
//      dump. #703's capture-safety timer (querySelectorAll('.reveal:not(.in)')
//      at 1600ms) stays in place and becomes the slower second net; the
//      visible-by-default CSS makes it a harmless no-op on healthy pages.
//
//   LAW 2 — HERO NEVER BLANK. The hero poster photograph paints instantly
//      (it is the .hero-visual reveal content LAW 1 already un-hides), and
//      a ladder-marked hero <video> attaches visibly ONLY once it can
//      actually draw: the donor walkers arm on loadeddata (readyState >= 2,
//      first frame decodable) and stamp data-hero-ready; the engine injects
//      a visibility guard that keeps a frameless video invisible over the
//      poster. Cold-cache first frame = the poster photograph, never gray.
//
//   LAW 3 — THE LOGO SLOT NEVER STRETCHES A BANNER. The ladder's mark rung
//      rejects landscape-banner aspect ratios (the measured defect: an
//      800x340 banner selected for the 46x46 square header plate) and falls
//      through to the next candidate, then the mark-fallback rungs.
//
// The chromium half of LAW 1 (a compiled page renders fully revealed with
// JS never executing the reveal script) is covered at the donor-byte and
// compiled-byte level here; the LIVE render half is held by
// test/compiled-site-skeleton.test.js, which must keep passing alongside.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS = path.join(BACKEND, "donors-clean");

// Real donor-library bytes only — no fixture shortcuts for the byte laws.
process.env.MIRROR_DONOR_ROOT = DONORS;
process.env.MIRROR_CLIENT_ROOT = process.env.MIRROR_CLIENT_ROOT
  || fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-firstimpression-"));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
if (!process.env.MIRROR_EVIDENCE_HMAC_KEY) process.env.MIRROR_EVIDENCE_HMAC_KEY = "first-impression-test-evidence-key";
if (!process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY) {
  process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY = "first-impression-robustness-test-key-000000";
}

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const firstImpression = require("../lib/mirror-engine/first-impression");
const { chooseBrandMark, MARK_MAX_ASPECT } = require("../lib/mirror-engine/logo-ladder");

function revealWiredDonors() {
  return fs.readdirSync(DONORS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(DONORS, name, "index.html")))
    .filter((name) => {
      const html = fs.readFileSync(path.join(DONORS, name, "index.html"), "utf8");
      return html.includes("querySelectorAll('.reveal')");
    });
}

// ---------------------------------------------------------------------------
// LAW 1 (donor bytes): the hidden state is armed progressive enhancement.
// ---------------------------------------------------------------------------

test("LAW 1 donor bytes: no un-gated hidden pre-state; arming + capture-safety + gate present", () => {
  assert.ok(revealWiredDonors().length >= 12, "the reveal-wired donor families went missing");
  for (const name of revealWiredDonors()) {
    const html = fs.readFileSync(path.join(DONORS, name, "index.html"), "utf8");
    const cssFiles = fs.readdirSync(path.join(DONORS, name, "assets"))
      .filter((f) => f.endsWith(".css"))
      .map((f) => fs.readFileSync(path.join(DONORS, name, "assets", f), "utf8"));

    // (1) The script arms every element BEFORE observing, then sets the
    // root gate — the progressive-enhancement contract.
    assert.match(html, /querySelectorAll\('\.reveal'\)\.forEach\(function \(el\) \{ el\.classList\.add\('reveal-armed'\); io\.observe\(el\); \}\);/,
      `${name}: the reveal script must arm each element before observing it`);
    assert.match(html, /document\.documentElement\.classList\.add\('js-reveal-armed'\)/,
      `${name}: the reveal script must set the js-reveal-armed root gate`);

    // (2) No stylesheet may hide .reveal except under the root gate. Any
    // `opacity: 0` applying to .reveal must carry the gate in its selector.
    for (const css of cssFiles) {
      const hiddenRules = css.match(/[^{}]*\.reveal[^{}]*\{[^}]*opacity:\s*0[^}]*\}/g) || [];
      for (const rule of hiddenRules) {
        assert.match(rule, /js-reveal-armed/,
          `${name}: a stylesheet hides .reveal without the js-reveal-armed gate — pre-JS hidden state is back:\n${rule.trim()}`);
      }
    }

    // (3) #703's capture-safety timer stays (the slower net; harmless where
    // the armed mechanism already ran).
    assert.ok(html.includes("querySelectorAll('.reveal:not(.in)')"),
      `${name}: the capture-safety reveal fallback is gone — full-page captures of this family read as broken pages`);
  }
});

test("LAW 1 donor CSS: visible-by-default rule and gated hidden rule present in every wired family", () => {
  for (const name of revealWiredDonors()) {
    const cssDir = path.join(DONORS, name, "assets");
    const all = fs.readdirSync(cssDir).filter((f) => f.endsWith(".css"))
      .map((f) => fs.readFileSync(path.join(cssDir, f), "utf8")).join("\n");
    assert.match(all, /\.js \.reveal \{ opacity: 1; transform: none; \}/,
      `${name}: lost the visible-by-default .js .reveal rule`);
    assert.match(all, /html\.js-reveal-armed \.reveal:not\(\.in\) \{ opacity: 0; transform: translateY\(18px\); \}/,
      `${name}: lost the gated (armed-only) hidden rule`);
  }
});

// ---------------------------------------------------------------------------
// LAW 1 + LAW 2 (compiled bytes): a real mirror() compile carries the nets.
// ---------------------------------------------------------------------------

const HOST = "wss-test-first-impression-roofing.wss-ai.com";

async function compileFalcon() {
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
    const type = /\.html?$/i.test(rel) ? "text/html; charset=utf-8"
      : /\.css$/i.test(rel) ? "text/css; charset=utf-8"
      : /\.m?js$/i.test(rel) ? "application/javascript"
      : /\.json$/i.test(rel) ? "application/json"
      : "application/octet-stream";
    return {
      status: buf ? 200 : 404,
      headers: { "content-type": type },
      body: buf ? buf : Buffer.from("<!doctype html><title>404</title>"),
    };
  };

  const deps = {
    siteEditLog: async () => ({ ok: true, configured: false, fingerprint: "", active: [], revoked: [], legacy: [] }),
    sharedPublisher: {
      supportsTwoPhaseQc: true,
      stage: async (input) => {
        Object.assign(captured, input.files);
        routeMap = input.routeMap || {};
        return {
          ok: true,
          state: "staged",
          previewUrl: `https://${HOST}/`,
          proofIdentity: {
            site_id: "33333333-3333-4333-8333-333333333333",
            release_id: "44444444-4444-4444-8444-444444444444",
            build_hash: input.buildHash,
          },
          releaseEvidence: {
            evidence_schema: "shared-site-release-evidence-v1",
            site_id: "33333333-3333-4333-8333-333333333333",
            release_id: "44444444-4444-4444-8444-444444444444",
            build_hash: input.buildHash,
            canonical_host: HOST,
            manifest_path: "sites/x/releases/y/manifest.json",
            manifest_sha256: "b".repeat(64),
            generation: 1,
            deployment_env: "production",
          },
          openPreview: async () => ({
            origin: `https://${HOST}/`,
            fetch: async (url) => {
              const file = serveFile(url);
              return {
                ok: file.status === 200,
                status: file.status,
                headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? file.headers["content-type"] : null) },
                text: async () => file.body.toString("utf8"),
                arrayBuffer: async () => {
                  const ab = new ArrayBuffer(file.body.length);
                  new Uint8Array(ab).set(file.body);
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

  const result = await mirror({
    slug: "wss-test-first-impression-roofing",
    donor: "roofing-falcon-clean",
    facts: {
      business_name: "First Impression Roofing",
      industry: "roofing",
      city: "Austin",
      state: "TX",
      phone: "+15125550188",
    },
    content: {
      services: [
        { name: "Roof Replacement", description: "Full tear-off and rebuild in architectural shingle." },
      ],
      reviews: [
        { text: "Clean crew, clean yard, honest quote.", author: "Austin homeowner" },
      ],
    },
  }, { registry: createRegistry(), deps });

  assert.equal(result.ok, true, `falcon compile failed: ${JSON.stringify(result.body).slice(0, 600)}`);
  assert.ok(Object.keys(captured).length >= 10, "the shared-publisher seam captured no files");
  return captured;
}

let compiled = null;
async function falcon() {
  if (!compiled) compiled = await compileFalcon();
  return compiled;
}

test("LAW 1 compiled bytes: no opacity-0 pre-state survives without the failsafe", { timeout: 240_000 }, async () => {
  const files = await falcon();
  const html = files["index.html"].toString("utf8");
  const css = files["assets/style.css"].toString("utf8");

  // The compiled stylesheet carries the armed pattern — and nothing else.
  assert.match(css, /\.js \.reveal \{ opacity: 1; transform: none; \}/,
    "compiled css lost the visible-by-default rule");
  assert.match(css, /html\.js-reveal-armed \.reveal:not\(\.in\) \{ opacity: 0/,
    "compiled css lost the gated hidden rule");
  const ungated = css.match(/[^{}]*\.reveal[^{}]*\{[^}]*opacity:\s*0[^}]*\}/g) || [];
  for (const rule of ungated) {
    assert.match(rule, /js-reveal-armed/, `compiled css hides .reveal un-gated:\n${rule.trim()}`);
  }

  // The engine's failsafe net is on the page: floor CSS + noscript + the
  // one-shot 900ms force-reveal.
  assert.ok(html.includes(firstImpression.REVEAL_MARKER), "compiled page lost the engine reveal-failsafe marker");
  assert.ok(html.includes("window.wssRevealFailsafe"), "compiled page lost the one-shot 900ms force-reveal");
  assert.ok(html.includes("wssRevealFailsafe=\"1\""), "the one-shot failsafe lost its idempotence guard");
  assert.match(html, /<noscript><style data-wss-reveal-failsafe>/, "compiled page lost the noscript force-reveal");
  assert.ok(html.includes("setTimeout"), "compiled page lost the failsafe timer");
  assert.ok(html.includes("900)"), "the one-shot failsafe is not on the 900ms window");

  // The arming contract survives compilation, and #703's slower net stays.
  assert.ok(html.includes("el.classList.add('reveal-armed'); io.observe(el);"),
    "compiled page lost the arm-before-observe contract");
  assert.ok(html.includes("document.documentElement.classList.add('js-reveal-armed')"),
    "compiled page lost the js-reveal-armed root gate");
  assert.ok(html.includes("querySelectorAll('.reveal:not(.in)')"),
    "compiled page lost #703's capture-safety fallback");
});

test("LAW 2 compiled bytes: poster visible by default, video hidden until it can draw", { timeout: 240_000 }, async () => {
  const files = await falcon();
  const html = files["index.html"].toString("utf8");
  const css = files["assets/style.css"].toString("utf8");

  // The poster photograph is plain eager markup inside .hero-visual — a
  // section the armed-reveal law keeps visible by default. Since the
  // hero-poster pass (audit A1, 2026-09-03) the tile must reference a REAL
  // shipped photograph (the donor's own poster for empty-pool builds —
  // never the drawn svg placeholder), with the onerror guard falling back
  // to the bundled photo instead of a broken-image icon.
  assert.match(html, /<div class="hero-visual reveal">\s*<img[^>]*src="assets\/[^"]*\.(?:jpe?g|png|webp)"/,
    "the hero poster img left its visible-by-default .hero-visual slot");
  assert.doesNotMatch(html, /hero-visual reveal">\s*<img[^>]*src="assets\/hero-poster\.svg"/,
    "the drawn svg placeholder is not the shipped hero tile");
  assert.match(html, /<div class="hero-visual reveal">\s*<img[^>]*onerror="this\.onerror=null;this\.src='[^']+'"/,
    "the hero poster img carries the bundled-photo onerror guard");

  // The walker mounts the video hidden, over the poster, and unhides it only
  // on loadeddata (readyState >= 2 — first frame decodable), stamping
  // data-hero-ready. The mount attributes live in the deferred hero bundle;
  // the ladder walker is inline.
  const bundle = Object.keys(files).map((rel) => (/assets\/index-.*\.js$/.test(rel) ? files[rel].toString("utf8") : "")).join("\n");
  assert.match(bundle, /MOUNT_ATTRS = \{[^}]*hidden:!0[^}]*\}/s,
    "the mounted hero video must start hidden");
  assert.match(bundle, /poster:HERO_POSTER/,
    "the mounted hero video must carry the poster photograph");
  assert.ok(!/loadedmetadata[^]{0,200}data-hero-armed/.test(html),
    "the walker still arms on loadedmetadata (readyState 1 — a frameless video can unhide gray)");
  assert.match(html, /addEventListener\("loadeddata",function\(\)\{clip\.hidden=false;clip\.removeAttribute\("data-hero-dead"\);clip\.setAttribute\("data-hero-armed","1"\);clip\.setAttribute\("data-hero-ready","1"\);\}/,
    "the walker must unhide on loadeddata and stamp data-hero-ready");

  // A frameless marked video can never paint over the poster: hidden means
  // display:none (donor paint-under style block + engine ladder failsafe),
  // and the engine guard holds visibility until data-hero-ready.
  assert.match(html, /video\[data-hero-video\]\[hidden\] \{ display: none !important; \}/,
    "compiled page lost the hidden-video display floor");
  assert.ok(html.includes(firstImpression.HERO_MARKER), "compiled page lost the engine hero-ready guard marker");
  assert.match(html, /html\.js video\[data-hero-video\]:not\(\[data-hero-ready\]\) \{ visibility: hidden !important; \}/,
    "compiled page lost the hero frame-ready visibility guard");
});

// ---------------------------------------------------------------------------
// LAW 3 (unit): the ladder rejects landscape banners for the square mark.
// ---------------------------------------------------------------------------

test("LAW 3: an 800x340 banner never wins the square mark slot — the fallback is chosen", () => {
  assert.equal(MARK_MAX_ASPECT, 1.6, "the mark aspect ceiling must sit on the fleet's 8:5 line");

  const bannerOnly = chooseBrandMark({
    logoCandidates: [{ url: "https://example.com/banner-800x340.png", sniff: "png", width: 800, height: 340 }],
    businessName: "Anchor Plumbing Co",
    accent: "#0b5cab",
  });
  assert.equal(bannerOnly.rung, "wordmark", "a landscape banner must fall to the wordmark rung");
  assert.equal(bannerOnly.value.type, "wordmark");
  assert.equal(bannerOnly.value.text, "Anchor Plumbing Co");

  const bannerThenSquare = chooseBrandMark({
    logoCandidates: [
      { url: "https://example.com/banner-800x340.png", sniff: "png", width: 800, height: 340 },
      { url: "https://example.com/mark-240x240.png", sniff: "png", width: 240, height: 240 },
    ],
    businessName: "Anchor Plumbing Co",
    accent: "#0b5cab",
  });
  assert.equal(bannerThenSquare.rung, "logo");
  assert.equal(bannerThenSquare.value.url, "https://example.com/mark-240x240.png",
    "a genuine square candidate after a banner must still be picked");

  const mild = chooseBrandMark({
    logoCandidates: [{ url: "https://example.com/mark-300x230.png", sniff: "png", width: 300, height: 230 }],
    businessName: "Anchor Plumbing Co",
    accent: "#0b5cab",
  });
  assert.equal(mild.rung, "logo", "a mildly wide genuine mark (300x230) must still win the rung");
});

test("LAW 3: the ladder's own self-test suite passes with the aspect guard", async () => {
  const { execFile } = require("node:child_process");
  await new Promise((resolve) => {
    execFile(process.execPath, [path.join(BACKEND, "lib", "mirror-engine", "logo-ladder.js"), "--test"],
      { encoding: "utf8" }, (err, stdout) => {
        assert.ok(!err, `logo-ladder --test failed: ${err}`);
        assert.match(stdout, /PASS: ASPECT GUARD: an 800x340 landscape banner never wins the square mark slot/);
        assert.ok(!/FAIL/.test(stdout), `self-test has failures:\n${stdout}`);
        resolve();
      });
  });
});

// ---------------------------------------------------------------------------
// The engine nets are idempotent and byte-neutral where they do not apply.
// ---------------------------------------------------------------------------

test("the first-impression pass is idempotent and skips pages without reveal/hero wiring", () => {
  const files = {
    "index.html": Buffer.from("<!doctype html><html class=\"no-js\"><body><section class=\"reveal\">x</section></body></html>"),
    "plain.html": Buffer.from("<!doctype html><html><body><p>no wiring here</p></body></html>"),
  };
  const first = firstImpression.applyToFiles(files);
  assert.equal(first.reveal_pages, 1, "exactly the wired page gets the reveal net");
  assert.equal(first.hero_pages, 0, "a page with no hero wiring gets no hero guard");
  assert.ok(!files["plain.html"].toString("utf8").includes(firstImpression.REVEAL_MARKER),
    "the net must stay byte-neutral on unwired pages");

  const before = files["index.html"].toString("utf8");
  const second = firstImpression.applyToFiles(files);
  assert.equal(second.reveal_pages, 0, "second pass must be a no-op");
  assert.equal(second.hero_pages, 0, "second pass must be a no-op");
  assert.equal(files["index.html"].toString("utf8"), before, "second pass changed bytes");
});
