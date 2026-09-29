"use strict";

// test/fencing-hero-chrome.test.js — THE UNLAYERED-CHROME LAW (audit A2,
// 2026-09-04, fix lane F1). The flex-bomb selector scoping is #710's law
// (test/hero-variant-scoping.test.js). This suite pins what #710 does NOT
// cover: the fleet chrome's unlayered rules walking over the clean donors'
// @layer stylesheets, and the injected corner chrome colliding with itself.
//
// CSS LAYERS ARE THE COMMON ROOT: the clean donors author in @layer, and any
// UNLAYERED rule — whatever its specificity — outranks every layered one.
// Two unlayered fleet rules exploited that by accident:
//
//   1. fleet-polish `:is(.hero,...) > * { position:relative; z-index:1 }`
//      demoted the donors' LAYERED `.hero-media { position:absolute; inset:0 }`
//      (and `.hero-scrim`) into the flow: the hero video became a 16:9
//      in-flow block and pushed the entire hero copy a full viewport below
//      the fold. Measured on the compiled fencing build with ONLY the #710
//      selector fix: H1 at y=945 of an 800px fold — the flex-bomb fix alone
//      does not bring the headline above the fold.
//   2. fleet-polish's 44px tap floor (`a { min-width:44px }`, ≤768px) replaced
//      the header brand anchor's LAYERED `min-width:min(220px,100%)`, and the
//      header flex then crushed the wordmark to its first letters with the
//      city wrapped mid-word ("Mu\nlfreesboro", every family, every site).
//
// And the corner chrome collided with itself on every site (audit A2
// family-wide table): the donor's own fixed ".floater" stacked under the
// chat launcher at the same bottom-right corner; the theme toggle pinned at
// top:14/right:14 printed over donor header phone CTAs.
//
// Laws in this file, one per block:
//   1. BYTE LAW — the compiled fencing sheet actually carries the four
//      fixes (hero-background revert, tap-floor brand exemption, floater
//      dedupe, toggle off the header).
//   2. GEOMETRY LAW — the compiled fencing build on real chromium, both
//      viewports (1280x800, 390x844), no scrolling: H1 AND its CTA row
//      above the fold, hero media positioned as a background layer, headline
//      words inline, the brand name rendered whole (never a two-letter
//      clip), one contact floater, the $149 pill fully inside the viewport,
//      and no overlap between toggle, chat, pill or the header phone.
// Skipped cleanly where chromium is not installed (same guard as the
// compiled-site-skeleton suite).

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");

// The REAL donor library — this suite exists to catch a regression in the
// shipped chrome-vs-donor contract itself.
process.env.MIRROR_DONOR_ROOT = path.join(BACKEND, "donors-clean");
// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-fencing-chrome-"));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
if (!process.env.MIRROR_EVIDENCE_HMAC_KEY) process.env.MIRROR_EVIDENCE_HMAC_KEY = "fencing-chrome-test-evidence-key";
if (!process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY) {
  process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY = "fencing-chrome-test-key-00000000000000000";
}

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

const HOST = "wss-test-master-fence-chrome-check.wss-ai.com";
const BUSINESS = "Master Fence LLC";

/** The compiled fencing donor, captured whole through the shared-publisher
 *  seam (same shape as compiled-site-skeleton). The signup config rides the
 *  request the way mirror-lane-build sends it after resolveSignupConfig, so
 *  the $149 panel and its pill are on the page — the audit measured the pill
 *  on every live site. */
async function compileFencing() {
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
    resolveBrandAssets: async () => ({
      ok: true, logo: null, accent: null, primary: null, hashes: {}, mediaMode: "origin",
      photos: [1, 2, 3, 4, 5].map((i) => ({
        url: `https://www.fencing-chrome-fixture.com/assets/p${i}.jpg`,
        ok: true,
        sha256: require("node:crypto").createHash("sha256").update(`fencing-chrome-${i}`).digest("hex"),
        ext: "jpg", mime: "image/jpeg",
        originUrl: `https://www.fencing-chrome-fixture.com/assets/final-p${i}.jpg`,
      })),
      heroVideo: null,
    }),
    sharedPublisher: {
      supportsTwoPhaseQc: true,
      stage: async (input) => {
        Object.assign(captured, input.files);
        routeMap = input.routeMap || {};
        return {
          ok: true, state: "staged", previewUrl: `https://${HOST}/`,
          proofIdentity: {
            site_id: "11111111-1111-4111-8111-111111111111",
            release_id: "22222222-2222-4222-8222-222222222222",
            build_hash: input.buildHash,
          },
          releaseEvidence: {
            evidence_schema: "shared-site-release-evidence-v1",
            site_id: "11111111-1111-4111-8111-111111111111",
            release_id: "22222222-2222-4222-8222-222222222222",
            build_hash: input.buildHash,
            canonical_host: HOST,
            manifest_path: "sites/x/releases/y/manifest.json",
            manifest_sha256: "a".repeat(64),
            generation: 1, deployment_env: "production",
          },
          openPreview: async () => ({
            origin: `https://${HOST}/`,
            fetch: async (url) => {
              const file = serveFile(url);
              return {
                ok: file.status === 200, status: file.status,
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
    slug: "wss-test-master-fence-chrome-check",
    donor: "fencing-sterling",
    facts: {
      business_name: BUSINESS,
      industry: "fencing",
      city: "Murfreesboro",
      state: "TN",
      phone: "+16155550142",
    },
    content: {
      services: [
        { name: "Cedar Privacy Fence", description: "Cedar pickets on treated posts, racked to the grade." },
        { name: "Ornamental Aluminum", description: "Powder-coated panels for pool codes and front yards." },
      ],
      faqs: [{ q: "How deep do you set posts?", a: "Thirty-six inches in concrete." }],
      reviews: [{ text: "Straight lines, clean yard.", author: "Murfreesboro homeowner" }],
    },
    brand: {
      media_mode: "origin",
      photos: [1, 2, 3, 4, 5].map((i) => `https://www.fencing-chrome-fixture.com/assets/p${i}.jpg`),
    },
    signup: { rileyTel: "tel:+19495550100", rileyDisplay: "(949) 555-0100", domain: HOST },
  }, { registry: createRegistry(), deps });

  assert.equal(result.ok, true, `fencing compile failed: ${JSON.stringify(result.body).slice(0, 600)}`);
  assert.ok(Object.keys(captured).length >= 10, "the shared-publisher seam captured no files");
  return captured;
}

let compiled = null;
async function fencing() {
  if (!compiled) compiled = await compileFencing();
  return compiled;
}

// ---------------------------------------------------------------------------
// 1. BYTE LAW — the four chrome fixes ship in the compiled output
// ---------------------------------------------------------------------------

test("the compiled fencing hero keeps its h1 inside section.hero (the hero owns the headline)", { timeout: 240_000 }, async () => {
  const files = await fencing();
  const html = files["index.html"].toString("utf8");

  const hero = html.match(/<section[^>]*class="hero[^"]*"[^>]*id="top"[\s\S]*?<\/section>/i)
    || html.match(/<section[^>]*id="top"[^>]*class="hero[^"]*"[\s\S]*?<\/section>/i);
  assert.ok(hero, "the hero section wrapper must survive compilation");
  assert.match(hero[0], /<h1[\s>]/, "the hero section must contain the page h1 — a text-free hero wall is the A2 S1 defect");
});

test("the compiled fleet chrome carries the unlayered-rule repairs (hero background layers, brand min-width)", { timeout: 240_000 }, async () => {
  const files = await fencing();
  const html = files["index.html"].toString("utf8");
  const css = files["assets/style.css"].toString("utf8");
  const all = html + css;

  // (a) hero background layers keep their own positioning: the raise-reset
  //     must be followed by the revert for .hero-media/.hero-scrim.
  assert.match(all, /:is\(\.hero, \.hero-section, \[data-hero\]\) > \*/,
    "the fleet hero veil reset is gone — verify the veil block still ships");
  assert.match(all, /> :is\(\.hero-media, \.hero-scrim,[^)]*\)\s*\{\s*position:\s*revert-layer/,
    "the hero background-layer revert is gone — unlayered chrome will demote the donor's absolute .hero-media back into the flow (A2 S1)");

  // (b) the tap floor exempts identity anchors from its min-width.
  assert.match(all, /:is\(a, button\):is\(\[class\*="brand" i\], \[class\*="logo" i\], \[class\*="wordmark" i\]\)\s*\{\s*min-width:\s*revert-layer/,
    "the tap-floor brand exemption is gone — the 44px min-width will crush layered donor brand anchors again (A2 S2)");
});

test("the compiled corner chrome ships deduped and off the header (floater, toggle)", { timeout: 240_000 }, async () => {
  const files = await fencing();
  const html = files["index.html"].toString("utf8");
  const css = files["assets/style.css"].toString("utf8");
  const all = html + css;

  // one contact affordance: where the chat launcher ships, the donor's own
  // floater stands down.
  assert.match(all, /body:has\(#wss-chat-root\)[^}]*\.floater[^}]*display:none!important/,
    "the donor-floater/chat dedupe rule is gone — the page renders the doubled floating widget (A2 family defect)");

  // the toggle is positioned off the header (bottom-anchored), never pinned
  // over the donor header's phone CTA. It sits ABOVE the chat launcher AND
  // the launcher's "AI Chat" tooltip (Class E audit: at 86px the toggle
  // printed straight through the tooltip on every family).
  assert.doesNotMatch(all, /\.wss-theme-toggle\{[^}]*top:14px/,
    "the theme toggle is pinned back at top:14px — it prints over donor header phone CTAs (A2 S5)");
  assert.match(all, /\.wss-theme-toggle\{[^}]*top:auto[^}]*bottom:calc\(156px/,
    "the theme toggle must be bottom-anchored above the chat tooltip and launcher, riding --wss-chat-clear");
  // one surface at a time: the toggle stands down while the chat panel is open.
  assert.match(all, /body:has\(#wss-chat-root\[data-open="true"\]\) \.wss-theme-toggle\{display:none\}/,
    "the toggle no longer stands down while the chat panel is open — two fixed surfaces will print through each other");
});

// ---------------------------------------------------------------------------
// 2. GEOMETRY LAW — the painted page, real chromium, no scrolling
// ---------------------------------------------------------------------------

let chromiumWorks = null;
async function chromiumAvailable() {
  if (chromiumWorks !== null) return chromiumWorks;
  try {
    const { launchChromium } = require("../lib/serverless-chromium");
    const browser = await launchChromium();
    await browser.close();
    chromiumWorks = true;
  } catch {
    chromiumWorks = false;
  }
  return chromiumWorks;
}

test("law: the compiled fencing hero paints headline, CTA, brand and corner chrome correctly on BOTH viewports (real chromium)", { timeout: 300_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const files = await fencing();

  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname.replace(/^\/+/, ""));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const buf = files[rel];
    if (!buf) { res.writeHead(404); res.end("missing"); return; }
    const type = /\.html?$/i.test(rel) ? "text/html; charset=utf-8"
      : /\.css$/i.test(rel) ? "text/css; charset=utf-8"
      : /\.m?js$/i.test(rel) ? "application/javascript"
      : rel.endsWith(".mp4") ? "video/mp4"
      : "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": buf.length });
    res.end(buf);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}/`;

  const { launchChromium } = require("../lib/serverless-chromium");
  const browser = await launchChromium();
  try {
    for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport: vp });
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 });
      // NO scroll — past the donors' capture-safety window, as the audit's
      // shutters (0.5s/2s/5s) and the skeleton suite both do.
      await page.waitForTimeout(2_600);

      const report = await page.evaluate(() => {
        const q = (sel) => document.querySelector(sel);
        const rect = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
        const h1 = q("section.hero h1") || q("h1");
        const cta = q(".hero .btn-row");
        const media = q(".hero-media");
        const brandName = q(".brand-name, [data-display-name]");
        const brandLink = q("header .brand") || q('header a[class*="brand" i]');
        const floater = q(".floater");
        const chat = q("#wss-chat-root");
        const toggle = q(".wss-theme-toggle");
        const pill = q("#wss-pill");
        const phone = [...document.querySelectorAll("header a, header span")]
          .find((el) => /\d{3}[- )]\d{3}/.test(el.textContent || "") && el.children.length === 0 && el.getBoundingClientRect().width > 0);
        const overlap = (a, b) => !!(a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
        return {
          vw: window.innerWidth, vh: window.innerHeight,
          h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
          h1Height: h1 ? Math.round(h1.getBoundingClientRect().height) : null,
          h1Lines: h1 ? (h1.innerText.match(/\n/g) || []).length + 1 : null,
          ctaTop: cta ? Math.round(cta.getBoundingClientRect().top) : null,
          mediaPosition: media ? getComputedStyle(media).position : null,
          brandNameWidth: brandName ? Math.round(brandName.getBoundingClientRect().width) : null,
          brandText: brandLink ? brandLink.innerText : null,
          floaterVisible: floater ? getComputedStyle(floater).display !== "none" : null,
          chatRect: rect(chat),
          toggleRect: rect(toggle),
          pillRect: rect(pill),
          phoneRect: rect(phone),
          toggleChatOverlap: overlap(rect(toggle), rect(chat)),
          togglePillOverlap: overlap(rect(toggle), rect(pill)),
          togglePhoneOverlap: overlap(rect(toggle), rect(phone)),
        };
      });

      const vpLabel = `${vp.width}x${vp.height}`;
      // S1: the headline and its CTA live in the hero, above the fold.
      assert.ok(report.h1Top !== null && report.h1Top >= 0 && report.h1Top < vp.height,
        `[${vpLabel}] hero h1 must paint above the fold: h1Top=${report.h1Top} of ${vp.height}`);
      assert.ok(report.h1Height !== null && report.h1Height < 480,
        `[${vpLabel}] hero h1 ballooned to ${report.h1Height}px — the one-word-per-line stack is back`);
      assert.ok(report.h1Lines !== null && report.h1Lines <= 3,
        `[${vpLabel}] hero h1 wraps to ${report.h1Lines} lines — words are stacking again`);
      assert.ok(report.ctaTop !== null && report.ctaTop < vp.height,
        `[${vpLabel}] the hero CTA row must paint above the fold: ctaTop=${report.ctaTop} of ${vp.height}`);
      // S1: the hero media is a background layer, not flow content.
      assert.equal(report.mediaPosition, "absolute",
        `[${vpLabel}] .hero-media computed position=${report.mediaPosition} — the hero video is back in the flow, pushing the copy below the fold`);
      // S2: the brand renders whole — never a two-letter mid-word clip.
      assert.ok(report.brandNameWidth === null || report.brandNameWidth >= 120,
        `[${vpLabel}] brand name squeezed to ${report.brandNameWidth}px — the tap-floor min-width is crushing the layered donor brand rule again`);
      assert.ok(!/^[A-Za-z]{1,3}\n/.test(String(report.brandText || "")),
        `[${vpLabel}] brand link innerText reads as a mid-word clip: ${JSON.stringify(report.brandText)}`);
      // S3: one contact affordance per corner.
      assert.equal(report.floaterVisible, false,
        `[${vpLabel}] the donor floater is visible alongside the chat launcher — the doubled floating widget is back`);
      assert.ok(report.chatRect && report.chatRect.width > 0, `[${vpLabel}] the chat launcher must ship`);
      // S4: the $149 pill fully inside the viewport.
      if (report.pillRect && report.pillRect.width > 0) {
        assert.ok(report.pillRect.left >= 0 && report.pillRect.right <= report.vw && report.pillRect.top >= 0 && report.pillRect.bottom <= report.vh,
          `[${vpLabel}] the $149 pill must sit fully inside the viewport: ${JSON.stringify(report.pillRect)}`);
      }
      // S5: the toggle never touches the header phone, the chat or the pill.
      assert.equal(report.toggleChatOverlap, false, `[${vpLabel}] theme toggle overlaps the chat launcher`);
      assert.equal(report.togglePillOverlap, false, `[${vpLabel}] theme toggle overlaps the $149 pill`);
      assert.equal(report.togglePhoneOverlap, false, `[${vpLabel}] theme toggle overlaps the header phone number`);

      await page.close();
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
});
