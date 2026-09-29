"use strict";

// test/fleet-chrome-geometry.test.js — THE CLASS E CHROME LAW (fleet audit,
// 2026-09-04, fix lane FE). The six near-miss sites failed ONLY criterion (d):
// "brand whole, one floater, no clipped pills/toggles". This suite pins the
// repaired fleet chrome so the whole cohort inherits the fix, on THREE
// different donor families (fencing-sterling, hvac-premier, plumbing-clean —
// clean-room HTML, Vite-bundle JS, and plumbing variants respectively).
//
// The four defects this suite pins shut, all measured family-wide at 390px
// AND 1280px before the fix:
//
//   E1. TWO fixed floaters colliding: the theme toggle sat at bottom:86px,
//       straight through the chat launcher's "AI Chat" tooltip (#wss-chat-cta,
//       bottom:66px with a ~65px painted height). The toggle now stacks above
//       the tooltip (bottom:156px + the measured --wss-chat-clear lift) and
//       stands down entirely while the chat panel is open.
//   E2. The mobile header call CTA clipped 80-134px off the right viewport
//       edge: brand (min 220px) + burger (44px) + CTA (147-200px) in a ~310px
//       flex row with wrap:nowrap. The fleet floor now wraps the header row
//       and bounds the CTA to it.
//   E3. The generic drawn triangle: a client-logo.png reference emitted
//       without the asset, whose onerror swapped in client-logo-fallback.svg
//       (a literal triangle). brandWordmarkFloor replaces unshipped
//       client-logo references with the typographic wordmark and strips every
//       triangle onerror handler fleet-wide.
//   E4. .brand-name mid-word clips: the name now renders whole or degrades to
//       a clean ellipsis (min-width:0 + text-overflow:ellipsis).
//
// Laws, in the shared-publisher seam style of fencing-hero-chrome.test.js:
//   1. BYTE LAW — the compiled families carry the four repairs.
//   2. GEOMETRY LAW — the painted pages on real chromium, both audit
//      viewports: the fixed-chrome stack never overlaps itself and stays
//      inside the viewport, the header call CTA is fully inside the viewport,
//      and the brand name is never mid-word clipped.
// Skipped cleanly where chromium is not installed (same guard as the
// compiled-site-skeleton and fencing-hero-chrome suites).

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const BACKEND = path.join(__dirname, "..");

// The REAL donor library — this suite exists to catch a regression in the
// shipped chrome-vs-donor contract itself.
process.env.MIRROR_DONOR_ROOT = path.join(BACKEND, "donors-clean");
// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = process.env.MIRROR_CLIENT_ROOT
  || fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-fleet-chrome-"));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
if (!process.env.MIRROR_EVIDENCE_HMAC_KEY) process.env.MIRROR_EVIDENCE_HMAC_KEY = "fleet-chrome-test-evidence-key";
if (!process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY) {
  process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY = "fleet-chrome-test-key-00000000000000000";
}

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

// THREE different donor families: clean-room HTML (fencing), a compiled Vite
// bundle donor (hvac), and the plumbing clean-room family. Class E was
// cohort-wide; the pins must be too.
const FAMILIES = [
  { donor: "fencing-sterling", business: "Master Fence LLC", industry: "fencing", city: "Murfreesboro", state: "TN" },
  { donor: "hvac-premier", business: "Verichill Houston", industry: "hvac", city: "Houston", state: "TX" },
  { donor: "plumbing-clean", business: "Reliable Plumbing", industry: "plumbing", city: "Chapin", state: "SC" },
];

const compiled = new Map();

async function compileFamily(family) {
  if (compiled.has(family.donor)) return compiled.get(family.donor);

  const slugToken = family.business.toLowerCase().replace(/[^a-z0-9]+/g, "-").split("-").slice(0, 2).join("-");
  const slug = `wss-test-fleet-chrome-${family.donor}-${slugToken}`;
  const host = `${slug}.wss-ai.com`;
  const captured = {};
  let routeMap = {};

  const deps = {
    siteEditLog: async () => ({ ok: true, configured: false, fingerprint: "", active: [], revoked: [], legacy: [] }),
    resolveBrandAssets: async () => ({
      ok: true, logo: null, accent: null, primary: null, hashes: {}, mediaMode: "origin",
      photos: [1, 2, 3, 4, 5].map((i) => ({
        url: `https://www.fleet-chrome-fixture.com/assets/p${i}.jpg`,
        ok: true,
        sha256: crypto.createHash("sha256").update(`fleet-chrome-${family.donor}-${i}`).digest("hex"),
        ext: "jpg", mime: "image/jpeg",
        originUrl: `https://www.fleet-chrome-fixture.com/assets/final-p${i}.jpg`,
      })),
      heroVideo: null,
    }),
    sharedPublisher: {
      supportsTwoPhaseQc: true,
      stage: async (input) => {
        Object.assign(captured, input.files);
        routeMap = input.routeMap || {};
        return {
          ok: true, state: "staged", previewUrl: `https://${host}/`,
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
            canonical_host: host,
            manifest_path: "sites/x/releases/y/manifest.json",
            manifest_sha256: "a".repeat(64),
            generation: 1, deployment_env: "production",
          },
          openPreview: async () => ({
            origin: `https://${host}/`,
            fetch: async (url) => {
              const u = new URL(url);
              let rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
              if (rel === "" || rel.endsWith("/")) rel += "index.html";
              let buf = captured[rel];
              if (!buf) {
                const mapped = routeMap[u.pathname] || routeMap[`${u.pathname}/`];
                if (mapped) buf = captured[mapped];
              }
              const body = buf ? buf : Buffer.from("<!doctype html><title>404</title>");
              const type = /\.html?$/i.test(rel) ? "text/html; charset=utf-8"
                : /\.css$/i.test(rel) ? "text/css; charset=utf-8"
                : /\.m?js$/i.test(rel) ? "application/javascript"
                : /\.svg$/i.test(rel) ? "image/svg+xml"
                : /\.json$/i.test(rel) ? "application/json"
                : "application/octet-stream";
              return {
                ok: !!buf, status: buf ? 200 : 404,
                headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? type : null) },
                text: async () => body.toString("utf8"),
                arrayBuffer: async () => {
                  const ab = new ArrayBuffer(body.length);
                  new Uint8Array(ab).set(body);
                  return ab;
                },
              };
            },
            preparePage: async () => {},
          }),
        };
      },
      activate: async (receipt) => ({ ok: true, previewUrl: `https://${host}/`, proofIdentity: receipt.proofIdentity }),
    },
    renderCheck: async () => ({ status: "passed", problems: [] }),
    renderAudit: async () => ({ status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] }),
  };

  const result = await mirror({
    slug,
    donor: family.donor,
    facts: {
      business_name: family.business,
      industry: family.industry,
      city: family.city,
      state: family.state,
      phone: "+16155550142",
      email: "office@example.com",
    },
    content: {
      services: [
        { name: "Core Service One", description: "Done to code, on schedule." },
        { name: "Core Service Two", description: "Written estimate before we start." },
      ],
      faqs: [{ q: "How fast can you start?", a: "Usually within the week." }],
      reviews: [{ text: "Clean work.", author: `${family.city} homeowner` }],
    },
    brand: {
      media_mode: "origin",
      photos: [1, 2, 3, 4, 5].map((i) => `https://www.fleet-chrome-fixture.com/assets/p${i}.jpg`),
    },
    signup: { rileyTel: "tel:+19495550100", rileyDisplay: "(949) 555-0100", domain: host },
  }, { registry: createRegistry(), deps });

  assert.equal(result.ok, true, `${family.donor} compile failed: ${JSON.stringify(result.body).slice(0, 600)}`);
  assert.ok(Object.keys(captured).length >= 10, `${family.donor}: the shared-publisher seam captured no files`);
  const files = { captured, routeMap };
  compiled.set(family.donor, files);
  return files;
}

// ---------------------------------------------------------------------------
// 1. BYTE LAW — the four Class E repairs ship in every compiled family
// ---------------------------------------------------------------------------

const TRIANGLE_ONERROR = /onerror\s*=\s*["'][^"']*(?:client-logo-fallback|mark-fallback)\.svg/i;
const CLIENT_LOGO_SRC = /src\s*=\s*["'](?!https?:\/\/)[^"']*\/assets\/client-logo\.(?:png|jpe?g|webp|gif|svg|avif)["']/i;

test("byte law: no family ships a triangle logo fallback or an unshipped client-logo reference (E3)", { timeout: 300_000 }, async () => {
  for (const family of FAMILIES) {
    const { captured } = await compileFamily(family);
    for (const [rel, buf] of Object.entries(captured)) {
      if (!/\.html?$/i.test(rel)) continue;
      const html = buf.toString("utf8");
      assert.doesNotMatch(html, TRIANGLE_ONERROR,
        `${family.donor}/${rel}: an onerror still swaps in the generic drawn triangle logo (Class E3)`);
      const srcMatch = CLIENT_LOGO_SRC.exec(html);
      if (srcMatch) {
        // The reference may only ship when the bytes ship beside it.
        const asset = `assets/client-logo.${/client-logo\.([a-z0-9]+)["']/i.exec(srcMatch[0])[1]}`;
        assert.ok(captured[asset],
          `${family.donor}/${rel}: emits ${asset} without shipping it — the 404 falls back to the drawn triangle (Class E3)`);
      }
    }
  }
});

test("byte law: the toggle stacks above the chat tooltip and stands down while chat is open (E1)", { timeout: 300_000 }, async () => {
  for (const family of FAMILIES) {
    const { captured } = await compileFamily(family);
    const css = Object.entries(captured)
      .filter(([rel]) => /\.css$/i.test(rel))
      .map(([, buf]) => buf.toString("utf8"))
      .join("\n");
    assert.doesNotMatch(css, /\.wss-theme-toggle\{[^}]*right:max[^}]*bottom:calc\(86px/,
      `${family.donor}: the right-anchored toggle is back at bottom:86px — it prints through the chat tooltip (Class E1). (The engine's mobile left-column relocation at 86px is intentional and stays.)`);
    assert.match(css, /\.wss-theme-toggle\{[^}]*bottom:calc\(156px \+ var\(--wss-chat-clear,0px\)/,
      `${family.donor}: the toggle must stack above the chat tooltip and launcher, riding --wss-chat-clear`);
    assert.match(css, /body:has\(#wss-chat-root\[data-open="true"\]\) \.wss-theme-toggle\{display:none\}/,
      `${family.donor}: the toggle must stand down while the chat panel is open`);
  }
});

test("byte law: the header wrap floor, brand-name ellipsis law and wordmark treatment ship fleet-wide (E2/E4)", { timeout: 120_000 }, async () => {
  const { fleetPolishCss } = require("../lib/mirror-engine/fleet-polish");
  const css = fleetPolishCss();
  assert.match(css, /flex-wrap: wrap; row-gap: 0\.5rem;/,
    "the mobile header wrap floor is gone — the call CTA will clip off 390px again (Class E2)");
  assert.match(css, /:is\(\.brand-name, \[class\*="brand-name" i\]\) \{\s*\n\s*min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis;/,
    "the brand-name ellipsis law is gone — mid-word clips return (Class E4)");
  assert.match(css, /\.wss-wordmark \{/, "the wordmark treatment is gone — the Class E3 swap has no styling");
});

// ---------------------------------------------------------------------------
// 2. GEOMETRY LAW — the painted page, real chromium, both audit viewports
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

for (const family of FAMILIES) {
  test(`law: ${family.donor} paints chrome with no overlaps, CTA inside the viewport, brand unclipped (real chromium)`, { timeout: 300_000 }, async (t) => {
    if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
    const { captured } = await compileFamily(family);

    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname.replace(/^\/+/, ""));
      if (rel === "" || rel.endsWith("/")) rel += "index.html";
      const buf = captured[rel];
      if (!buf) { res.writeHead(404); res.end("missing"); return; }
      const type = /\.html?$/i.test(rel) ? "text/html; charset=utf-8"
        : /\.css$/i.test(rel) ? "text/css; charset=utf-8"
        : /\.m?js$/i.test(rel) ? "application/javascript"
        : /\.svg$/i.test(rel) ? "image/svg+xml"
        : /\.mp4$/i.test(rel) ? "video/mp4"
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
        // NO scroll — the audit's at-rest shutters do not scroll either.
        await page.waitForTimeout(2_600);

        const report = await page.evaluate(() => {
          const vw = window.innerWidth, vh = window.innerHeight;
          const rect = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
          const overlap = (a, b) => !!(a && b
            && !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5)
            && !(a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5));
          const inside = (r) => !!r && r.width > 0 && r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
          const toggle = document.querySelector(".wss-theme-toggle");
          const chatRoot = document.querySelector("#wss-chat-root");
          const chatCta = document.querySelector("#wss-chat-cta");
          const launcher = document.querySelector("#wss-chat-launcher");
          // The header call CTA: a phone-shaped control painted in the header.
          const headerControls = [...document.querySelectorAll("header a, header button, masthead a, .masthead a")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              if (!(r.width > 0 && r.height > 0)) return false;
              return el.matches('a[href^="tel:"]') || /\(\d{3}\)\s*\d{3}/.test(el.textContent || "");
            });
          const brandName = document.querySelector(".brand-name, [class*='brand-name' i], [data-display-name]");
          let brand = null;
          if (brandName) {
            const s = getComputedStyle(brandName);
            const cs = brandName.clientWidth, sw = brandName.scrollWidth;
            brand = {
              width: Math.round(brandName.getBoundingClientRect().width),
              clipped: sw > cs + 1,
              cleanEllipsis: s.overflow === "hidden" && s.textOverflow === "ellipsis",
              whiteSpace: s.whiteSpace,
              text: (brandName.textContent || "").trim(),
            };
          }
          const tRect = rect(toggle), ctaRect = rect(chatCta), rootRect = rect(chatRoot), lRect = rect(launcher);
          return {
            vw, vh,
            toggleVisible: toggle ? getComputedStyle(toggle).display !== "none" : false,
            toggle: tRect, chatCta: ctaRect, chatRoot: rootRect, launcher: lRect,
            toggleInside: inside(tRect),
            chatCtaInside: !ctaRect || inside(ctaRect) || getComputedStyle(chatCta).display === "none",
            launcherInside: inside(lRect),
            toggleVsTooltip: overlap(tRect, ctaRect),
            toggleVsLauncher: overlap(tRect, lRect),
            toggleVsRoot: overlap(tRect, rootRect),
            callCta: headerControls.map((el) => {
              const r = el.getBoundingClientRect().toJSON();
              return { text: (el.textContent || "").trim().slice(0, 40), inside: inside(r), right: Math.round(r.right) };
            }),
            brand,
          };
        });

        const vpLabel = `${vp.width}x${vp.height}`;
        const fail = (msg) => { throw new Error(`[${family.donor} @ ${vpLabel}] ${msg}`); };
        // E1: the fixed chrome never overlaps itself and stays on-screen.
        assert.ok(report.toggleVisible, `the theme toggle must ship`);
        assert.equal(report.toggleVsTooltip, false, "theme toggle overlaps the chat tooltip (Class E1)");
        assert.equal(report.toggleVsLauncher, false, "theme toggle overlaps the chat launcher (Class E1)");
        assert.equal(report.toggleVsRoot, false, "theme toggle overlaps the chat launcher root (Class E1)");
        assert.ok(report.toggleInside, `theme toggle escapes the viewport: ${JSON.stringify(report.toggle)}`);
        assert.ok(report.launcherInside, `chat launcher escapes the viewport: ${JSON.stringify(report.launcher)}`);
        assert.ok(report.chatCtaInside, `chat tooltip escapes the viewport: ${JSON.stringify(report.chatCta)}`);
        // E2: the header call CTA is fully inside the viewport.
        for (const cta of report.callCta) {
          assert.ok(cta.inside,
            `header call CTA ${JSON.stringify(cta.text)} clipped off the viewport (right=${cta.right} of ${report.vw}) — the header row overflows again (Class E2)`);
        }
        // E4: the brand name renders, whole or with a clean ellipsis — never
        // a mid-word clip.
        assert.ok(report.brand && report.brand.width > 0, "no painted .brand-name found");
        assert.equal(report.brand.clipped && !report.brand.cleanEllipsis, false,
          `brand name ${JSON.stringify(report.brand.text)} is hard-clipped without an ellipsis (Class E4): ${JSON.stringify(report.brand)}`);

        await page.close();
      }
    } finally {
      await browser.close().catch(() => {});
      server.close();
    }
  });
}
