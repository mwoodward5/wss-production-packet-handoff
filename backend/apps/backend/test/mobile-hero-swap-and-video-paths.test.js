"use strict";

// test/mobile-hero-swap-and-video-paths.test.js — THE CLASS C + CLASS D LAW
// (final-qa verdict-matrix 2026-09-04).
//
//   CLASS C (hage / searchfunder / nm-authority): the mobile recovery script
//   used to SWAP the real hero for a generic "HVAC in Houston, TX" panel —
//   a hydration/reveal race made the h1 read invisible at 900ms, and the
//   "recovery" built a photo-less substitute section and hid the real hero
//   behind it (probe heroH 1338→0, H1 text replaced). The law now: the real
//   hero content is NEVER replaced — the recovery's only move is the
//   #703/#707 force-reveal of the REAL h1. The photo and the H1 survive at
//   every viewport and every timing.
//
//   CLASS D (bradley): the hero video's emitted references pointed at
//   root-absolute `/hero/…` paths that 404 under any mount-below-prefix
//   server (the multi-site preview/QA topology), so the poster never
//   painted and the dead video rendered as a blank rectangle occluding the
//   H1. The law now: every emitted video src/poster reference resolves to
//   shipped bytes (hero-poster's ships-assertion pattern extended to the
//   video ladder), the video stays hidden until a real loaded frame
//   (existing law, untouched), and the poster photograph is the
//   visible-by-default surface.
//
// The donor under test is hvac-premier — the exact donor family behind
// bradley and the Class C sites: a populated video ladder whose fallback
// clip ships real bytes, a real bundled poster photograph, and the mobile
// fold + recovery seam. The chromium legs run under a PREFIX server
// (`/<slug>/…`, the QA topology where root-absolute references 404) and
// probe the first-second surface at ~0.5s AND ~5s.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");

process.env.MIRROR_DONOR_ROOT = path.join(BACKEND, "donors-clean");
// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-mobile-swap-"));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
if (!process.env.MIRROR_EVIDENCE_HMAC_KEY) process.env.MIRROR_EVIDENCE_HMAC_KEY = "mobile-swap-test-evidence-key";
if (!process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY) {
  process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY = "mobile-swap-video-paths-test-key-0000000000";
}

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const heroVideoPathsLib = require("../lib/mirror-engine/hero-video-paths");

const HOST = "wss-test-prairie-peak-hvac.wss-ai.com";
const SLUG = "wss-test-prairie-peak-hvac";

/** The compiled hvac-premier, captured whole through the shared-publisher
 * seam (the same fixture shape as compiled-site-skeleton.test.js — never a
 * fixture shortcut). No client media at all: the build rides the donor's
 * own bundled real poster photograph and the WSS fallback clip, exactly the
 * bradley/Class-C condition. */
async function compileHvac() {
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
      : rel.endsWith(".mp4") ? "video/mp4"
      : /\.(?:jpe?g|png|webp|svg)$/i.test(rel) ? "image/*"
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
      ok: true,
      logo: null,
      accent: null,
      primary: null,
      hashes: {},
      mediaMode: "housed",
      photos: [],
      heroVideo: null,
    }),
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
    slug: SLUG,
    donor: "hvac-premier",
    facts: {
      business_name: "Prairie Peak HVAC",
      industry: "hvac",
      city: "Houston",
      state: "TX",
      phone: "+17135550164",
    },
    content: {
      services: [
        { name: "AC Repair", description: "Same-day cooling repair across the metro." },
        { name: "Furnace Install", description: "High-efficiency furnaces, sized right." },
      ],
      faqs: [{ q: "Do you offer free estimates?", a: "Yes — written estimates are always free." }],
      reviews: [{ text: "Fast, honest, and tidy.", author: "A Houston homeowner" }],
    },
  }, { registry: createRegistry(), deps });

  assert.equal(result.ok, true, `hvac compile failed: ${JSON.stringify(result.body).slice(0, 600)}`);
  assert.ok(Object.keys(captured).length >= 10, "the shared-publisher seam captured no files");
  if (process.env.GHOST_DUMP_DIR) {
    fs.mkdirSync(process.env.GHOST_DUMP_DIR, { recursive: true });
    for (const [rel, buf] of Object.entries(captured)) {
      const dest = path.join(process.env.GHOST_DUMP_DIR, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }
    fs.writeFileSync(path.join(process.env.GHOST_DUMP_DIR, "_report.json"), JSON.stringify(result.body, null, 2));
  }
  return { files: captured, report: result.body };
}

let compiled = null;
async function hvac() {
  if (!compiled) compiled = await compileHvac();
  return compiled;
}

/* ------------------------------------------------------------------ *
 * CLASS C — the recovery never substitutes generic content (compile law)
 * ------------------------------------------------------------------ */

test("CLASS C: the shipped mobile recovery is content-preserving — no generic panel, no hidden hero", { timeout: 240_000 }, async () => {
  const { files } = await hvac();
  const html = files["index.html"].toString("utf8");
  const recovery = /<script id="wss-mobile-hero-recovery">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(recovery, "the compiled page must ship the mobile hero recovery script");
  const script = recovery[1];

  // The generic-panel machinery is gone from the shipped bytes.
  assert.doesNotMatch(script, /wss-mobile-hero-fallback/, "the recovery must not create the generic fallback panel");
  assert.doesNotMatch(script, /createElement/, "the recovery must not build substitute DOM");
  assert.doesNotMatch(script, /insertBefore|append\(/, "the recovery must not inject substitute content");
  assert.doesNotMatch(script, /display","none|display":"none|aria-hidden/, "the recovery must never hide the real hero");
  assert.doesNotMatch(script, /atob\(/, "the recovery must not carry a substitute-copy payload");

  // Its only move is the #703/#707 force-reveal of the REAL h1.
  assert.match(script, /visible\(hero\.querySelector\("h1"\)\)/, "the recovery must still gate on the real hero's own h1");
  assert.match(script, /classList\.add\("in"\)/, "the recovery force-reveals through the reveal law's .in class");
  assert.match(script, /data-wss-mobile-hero-real/, "a forced real hero must be marked so");
  assert.match(script, /setTimeout\(recover,900\)/, "the recovery keeps its 900ms first tick");
});

test("CLASS C: mobile chromium fixture — real hero photo + H1 present at 0.5s AND 5s, no substitution ever", { timeout: 180_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const { files } = await hvac();
  await withPrefixServer(files, async (origin) => {
    const session = await openMobilePage();
    const { browser } = session;
    try {
      const page = await session.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 });

      const early = await heroSurface(page);
      assert.ok(early.heroHeight > 200, `the real hero must be up in the first second (heroH ${early.heroHeight})`);
      assert.ok(early.h1.length >= 8, `the real H1 text must be present at ~0.5s (saw "${early.h1}")`);
      assert.equal(early.fallbackPanel, null, "no generic panel may ever exist");
      assert.ok(early.posterSrc, "the hero poster photograph must be referenced in the first second");

      // Past every recovery tick (900/1800/3500ms): the swap used to land here.
      await page.waitForTimeout(5_000);
      const late = await heroSurface(page);
      assert.equal(late.fallbackPanel, null, "CLASS C regression: the generic panel replaced the real hero by 5s");
      assert.ok(late.heroHeight > 200, `the real hero must survive at 5s (heroH ${late.heroHeight})`);
      assert.equal(late.h1, early.h1, "the H1 text must be the SAME real content at 0.5s and 5s — never substituted");
      assert.ok(late.posterLoaded, "the hero poster photograph must have loaded real bytes by 5s");
      assert.ok(late.posterVisible, "the poster photograph must be the visible-by-default surface");

      // The generic panel's old copy signature must not exist anywhere.
      assert.doesNotMatch(await page.content(), /mobile introduction/, "the old generic-panel aria-label must never ship");
      assert.deepEqual(session.pageErrors, [], "the compiled page must not throw");
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test("CLASS C: a hidden-h1 race force-reveals the REAL h1 — never a substitute panel", { timeout: 180_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const { files } = await hvac();
  // Simulate the exact trigger the old recovery swapped on: a late stylesheet
  // or reveal arming leaving the hero's own h1 invisible on mobile (the h1's
  // computed opacity reads 0 when the recovery's tick fires). Applied through
  // an init script so the poison is deterministic against the cascade; the
  // recovery's own inline !important force-reveal must beat it. The old code
  // answered this state with the generic panel; the new law force-reveals
  // the real h1.
  await withPrefixServer(files, async (origin) => {
    const session = await openMobilePage();
    const { browser } = session;
    try {
      const page = await session.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
          const hero = document.querySelector("section.hero") || document.querySelector("main section");
          const h1 = hero && hero.querySelector("h1");
          if (h1) h1.style.setProperty("opacity", "0", "important");
        });
      });
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(5_000);

      const state = await page.evaluate(() => {
        const hero = document.querySelector("section.hero") || document.querySelector("main section");
        const h1 = hero && hero.querySelector("h1");
        const cs = h1 ? getComputedStyle(h1) : null;
        return {
          fallbackPanel: document.getElementById("wss-mobile-hero-fallback"),
          recovered: document.documentElement.getAttribute("data-wss-mobile-hero-recovered"),
          realMarked: hero && hero.getAttribute("data-wss-mobile-hero-real"),
          h1Text: h1 ? h1.textContent.trim() : "",
          opacity: cs ? cs.opacity : "no-h1",
          height: h1 ? Math.round(h1.getBoundingClientRect().height) : 0,
          heroHeight: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
        };
      });
      assert.equal(state.fallbackPanel, null, "even on the race condition the generic panel must never be built");
      assert.equal(state.recovered, "true", "the recovery must have force-revealed the real h1");
      assert.equal(state.realMarked, "true", "the real hero must carry the content-preserving recovery mark");
      assert.equal(state.opacity, "1", `the real h1 must be forced visible (opacity ${state.opacity})`);
      assert.ok(state.height > 0 && state.heroHeight > 200, "the real hero and its h1 must survive the race");
      assert.ok(state.h1Text.length >= 8, `the real H1 text must survive (saw "${state.h1Text}")`);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

/* ------------------------------------------------------------------ *
 * CLASS D — every emitted video reference resolves to shipped bytes
 * ------------------------------------------------------------------ */

test("CLASS D: no emitted root-absolute video path and no walker absolutization survives compilation", { timeout: 240_000 }, async () => {
  const { files } = await hvac();
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.(html|js|css)$/i.test(rel)) continue;
    const text = buf.toString("utf8");
    assert.doesNotMatch(text, /charAt\(0\)\s*===\s*["']\/["']\s*\?\s*\w+\s*:\s*["']\/["']\s*\+/,
      `${rel} still ships the walkers' runtime root-absolutization`);
    assert.doesNotMatch(text, /url\(\s*["']?\/(?:hero|media)\/[^)"']*(?:mp4|webm|jpe?g|png|webp)/i,
      `${rel} still ships a root-absolute paint-under url() — it 404s under prefix serving`);
    assert.doesNotMatch(text, /poster=\s*["']\/(?:hero|media)\//i,
      `${rel} still ships a root-absolute video poster attribute`);
  }
});

test("CLASS D: the ships assertion holds — every emitted video src/poster resolves to shipped bytes", { timeout: 240_000 }, async () => {
  const { files, report } = await hvac();
  const verdict = heroVideoPathsLib.assertHeroVideoShips({
    files,
    manifest: JSON.parse(fs.readFileSync(path.join(BACKEND, "donors-clean", "hvac-premier", "BOILERPLATE.json"), "utf8")),
  });
  assert.equal(verdict.ok, true, `dangling video references: ${JSON.stringify(verdict.dangling)}`);
  assert.ok(verdict.refs >= 1, `the assertion must have checked real references (saw ${verdict.refs})`);
  assert.deepEqual(verdict.dangling, [], "no dangling video reference may survive");

  // The ladder island names only shipped rungs, site-relative.
  const html = files["index.html"].toString("utf8");
  const island = /<script type="application\/json" id="hero-video-ladder"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(island, "the compiled page must ship the ladder island");
  const sources = JSON.parse(island[1]).sources;
  assert.ok(sources.length >= 1, "the ladder must keep a shipping rung (real motion surface)");
  for (const rung of sources) {
    const rel = String(rung).replace(/^\//, "");
    assert.ok(files[rel], `ladder rung must ship in the bundle: ${rung}`);
  }

  // The engine report carries the path law verdict for ops (the media block
  // nests under checks.brand in the publish manifest).
  const pathsReport = (report.checks && report.checks.brand && report.checks.brand.hero_video && report.checks.brand.hero_video.paths)
    || (report.brand && report.brand.hero_video && report.brand.hero_video.paths)
    || (report.hero_video && report.hero_video.paths)
    || null;
  assert.ok(pathsReport, "the engine report must carry the hero-video path law verdict");
  assert.equal(pathsReport.applied, true, "the hero-video path pass must report applied");
  assert.equal(pathsReport.assertion && pathsReport.assertion.ok, true, "the engine-run ships assertion must pass");

  // The runtime half of the white-rectangle law ships too: the video stays
  // hidden until a real loaded frame, and the poster img is visible by default.
  assert.match(html, /data-wss-hero-ready-guard|data-wss-hero-failsafe/,
    "the frame-ready guard / ladder failsafe net must ship on a ladder page");
  const posterImg = /<img\b[^>]*hero-poster[^>]*>/i.exec(html);
  assert.ok(posterImg, "the hero poster img must ship");
  assert.doesNotMatch(posterImg[0], /\bhidden\b/, "the poster img must be visible-by-default (never hidden)");
});

test("CLASS D: chromium under PREFIX serving — video arms a real frame or stays hidden, poster paints, zero 404s", { timeout: 180_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const { files } = await hvac();
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await withPrefixServer(files, async (origin) => {
      const session = await openMobilePage();
      const { browser } = session;
      try {
        const page = await session.newPage({ viewport });
        await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(5_000);

        const state = await page.evaluate(() => {
          const hero = document.querySelector("section.hero") || document.querySelector("main section");
          const poster = hero ? hero.querySelector('img[src*="hero-poster"]') : null;
          const videos = [...document.querySelectorAll("video[data-hero-video]")].map((v) => {
            const cs = getComputedStyle(v);
            return {
              readyState: v.readyState,
              hidden: v.hidden,
              displayNone: cs.display === "none",
              visibilityHidden: cs.visibility === "hidden",
              dead: v.hasAttribute("data-hero-dead"),
              frameReady: v.hasAttribute("data-hero-ready"),
              src: v.getAttribute("src") || "",
            };
          });
          return {
            posterSrc: poster ? poster.getAttribute("src") : "",
            posterLoaded: poster ? poster.naturalWidth > 0 : false,
            posterVisible: poster ? getComputedStyle(poster).display !== "none" : false,
            videos,
            h1: hero && hero.querySelector("h1") ? hero.querySelector("h1").textContent.trim() : "",
            h1Box: hero && hero.querySelector("h1") ? Math.round(hero.querySelector("h1").getBoundingClientRect().height) : 0,
          };
        });

        // THE NO-WHITE-BOX LAW: every mounted hero video either drew a real
        // frame or is fully hidden — never a visible box without a frame.
        // (The hvac-premier donor is poster-first: preload="none", the clip
        // stays dormant until the visitor's tap — hidden-until-a-real-frame
        // is exactly the #707 law this build must keep.)
        for (const v of state.videos) {
          const drew = v.readyState >= 2 || v.frameReady;
          const hidden = v.hidden || v.displayNone || v.visibilityHidden || v.dead;
          assert.ok(drew || hidden,
            `a hero video is visible without a frame (readyState ${v.readyState}, src ${v.src}) — the white-rectangle state`);
          // The Class D path law at runtime: an assigned src is the island's
          // own site-relative rung, never the old root-absolute form that
          // 404'd under prefix serving.
          if (v.src) assert.ok(!/^\//.test(v.src), `the armed rung must be site-relative, not root-absolute (${v.src})`);
        }
        assert.ok(state.videos.length >= 1, "the hero video must mount on this donor");
        // The dormant rung must be the SHIPPED fallback clip exactly as the
        // island names it — a real byte path, not a dead reference.
        const srcd = state.videos.find((v) => v.src);
        assert.ok(srcd, "the walker arms the island's rung on the mounted video");
        assert.ok(files[srcd.src], `the assigned rung ships in the bundle (${srcd.src})`);

        // The poster photograph resolves and paints (the Class D surface).
        assert.ok(state.posterSrc, "the hero poster img must exist");
        assert.ok(!/^\//.test(state.posterSrc), `the poster src must be site-relative, not root-absolute (${state.posterSrc})`);
        assert.ok(state.posterLoaded, `the poster must load real bytes under prefix serving (${state.posterSrc})`);
        assert.ok(state.posterVisible, "the poster img must be visible-by-default");
        assert.ok(state.h1.length >= 8 && state.h1Box > 0,
          `the real H1 must not be occluded into nothing (text "${state.h1}", box ${state.h1Box})`);

        // Zero failed requests for hero media — the 404s are the defect.
        const hero404 = session.failed.filter((u) => /\/(?:hero|assets\/hero-|media)\//.test(u));
        assert.deepEqual(hero404, [], `hero media requests failed under prefix serving: ${hero404.join(", ")}`);
      } finally {
        await browser.close().catch(() => {});
      }
    });
  }
});

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

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

async function openMobilePage() {
  const { launchChromium } = require("../lib/serverless-chromium");
  const browser = await launchChromium();
  const pageErrors = [];
  const failed = [];
  return {
    browser,
    pageErrors,
    failed,
    async newPage(options) {
      const page = await browser.newPage(options);
      page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e)));
      page.on("requestfailed", (r) => failed.push(r.url()));
      page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
      return page;
    },
  };
}

/** The multi-site preview topology: the build serves BELOW /<slug>/, and
 * anything at the server root 404s — the exact surface where the Class D
 * root-absolute references died. */
async function withPrefixServer(files, fn) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const pathname = decodeURIComponent(u.pathname);
    if (!pathname.startsWith(`/${SLUG}/`) && pathname !== `/${SLUG}`) {
      res.writeHead(404); res.end("outside site prefix"); return;
    }
    let rel = pathname === `/${SLUG}` ? "" : pathname.slice(SLUG.length + 2);
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const buf = files[rel];
    if (!buf) { res.writeHead(404); res.end("missing"); return; }
    const type = /\.html?$/i.test(rel) ? "text/html; charset=utf-8"
      : /\.css$/i.test(rel) ? "text/css; charset=utf-8"
      : /\.m?js$/i.test(rel) ? "application/javascript"
      : rel.endsWith(".mp4") ? "video/mp4"
      : /\.(?:jpe?g|png|webp|svg)$/i.test(rel) ? "image/jpeg"
      : "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": buf.length });
    res.end(buf);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}/${SLUG}/`;
  try {
    await fn(origin);
  } finally {
    server.close();
  }
}

/** The first-second hero surface probe — the same measurements the QA
 * matrix used (heroH, H1 text, panel presence, poster state). */
async function heroSurface(page) {
  return page.evaluate(() => {
    const hero = document.querySelector("section.hero") || document.querySelector("main section");
    const h1 = hero ? hero.querySelector("h1") : null;
    const poster = hero ? hero.querySelector('img[src*="hero-poster"]') : null;
    return {
      heroHeight: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
      h1: h1 ? h1.textContent.trim() : "",
      fallbackPanel: document.getElementById("wss-mobile-hero-fallback"),
      posterSrc: poster ? poster.getAttribute("src") : "",
      posterLoaded: poster ? poster.naturalWidth > 0 : false,
      posterVisible: poster ? getComputedStyle(poster).display !== "none" : false,
    };
  });
}
