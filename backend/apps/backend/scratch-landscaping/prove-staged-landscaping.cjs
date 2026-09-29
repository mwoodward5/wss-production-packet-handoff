"use strict";
/**
 * scratch-landscaping/prove-staged-landscaping.cjs — RENDER THE DOM, not the claim.
 *
 * Proves the rebuilt landscaping-evergreen donor (client-SPA, single bundle)
 * against the exact live failures it was rebuilt to cure:
 *
 *   sameness: rendered_h1_not_client_derived   (the baked donor headline)
 *   mobile_fold: donor_hero_unmeasured         (no hero_wash selector)
 *
 * plus the library's structural invariants (ESM, residue, identity gate,
 * photo slots referenced, island consumption incl. the new reviews section).
 *
 * Fixture prospect is FICTIONAL on purpose (truth law / zero real-prospect
 * residue): "Cedar Bend Lawn & Landscape", Round Rock TX.
 *
 *   node scratch-landscaping/prove-staged-landscaping.cjs
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const BACKEND = path.join(__dirname, "..");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-lscp-proof-"));

const { loadDonor } = require(path.join(BACKEND, "lib/mirror-engine/donor"));
const { hydrate } = require(path.join(BACKEND, "lib/mirror-engine/hydrate"));
const { ALLOWED_TOKENS } = require(path.join(BACKEND, "lib/mirror-engine/tokens"));
const { identityScan } = require(path.join(BACKEND, "lib/mirror-engine/scan"));
const { composeIdentityCopy } = require(path.join(BACKEND, "lib/mirror-engine/identity-copy"));
const { samenessCheck } = require(path.join(BACKEND, "lib/mirror-engine/sameness"));

const DONOR = path.join(BACKEND, "donors-clean", "landscaping-evergreen");
const ESM_SYNTAX = /(^|[;}])(import|export)[{ ]|import\.meta|import\(/;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// Fixture prospect (fictional) + the engine's own composed copy
// ---------------------------------------------------------------------------
const FACTS = {
  business_name: "Cedar Bend Lawn & Landscape",
  industry: "landscaping",
  city: "Round Rock",
  state: "TX",
  rating: 4.8,
  review_count: 57,
};
const COPY = composeIdentityCopy({ facts: FACTS, marketCity: FACTS.city });

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: FACTS.business_name,
    CITY: FACTS.city, ADDRESS_CITY: FACTS.city, STATE: FACTS.state, REGION: FACTS.state,
    HERO_HEADLINE: COPY.headline,
    HERO_LINE_A: COPY.lines.a,
    HERO_LINE_B: COPY.lines.b,
    HERO_LINE_C: COPY.lines.c,
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(512) 555-0134", PHONE_DIGITS: "5125550134",
      EMAIL: "crew@example.com", PROFILE_URL: "https://maps.google.com/?cid=1",
      RATING: "4.8", REVIEW_COUNT: "57",
      GEO_LAT: "30.5083", GEO_LNG: "-97.6789",
    });
  }
  return tv;
}

// The engine's island, as content-inject.js writes it (data island before the
// bundle script). Verified-content fixture: services, faqs and reviews.
const ISLAND = {
  version: "wss-content-v1",
  facts: {
    business_name: FACTS.business_name, city: FACTS.city, address_city: FACTS.city,
    state: FACTS.state, phone: "(512) 555-0134", phone_digits: "5125550134",
    email: "crew@example.com", rating: 4.8, review_count: 57,
  },
  services: [
    { name: "Lawn Mowing & Edging", description: "Weekly and bi-weekly mowing routes with clean edges." },
    { name: "Landscape Installs", description: "Beds, plantings and stonework installed to plan." },
    { name: "Irrigation Checks", description: "Seasonal walk-throughs that keep water where it belongs." },
  ],
  faqs: [{ q: "Do you offer recurring service?", a: "Yes, weekly and bi-weekly routes." }],
  reviews: [
    { name: "R. Alvarez", city: "Round Rock", text: "Crew showed up when they said and the yard has never looked better.", rating: 5,
      avatarUrl: "https://lh3.googleusercontent.com/wss-proof-reviewer-face", publishedAt: "2026-05-01" },
    { name: "T. Nguyen", text: "Fair estimate, clean lines, zero drama.", rating: 5 },
  ],
};

function withIsland(html) {
  const tag = `<script id="wss-content" type="application/json">${JSON.stringify(ISLAND)}</script>\n` +
    `<script>try{var e=document.getElementById("wss-content");if(e)window.__WSS_CONTENT__=JSON.parse(e.textContent)}catch(x){}</script>\n`;
  // Before the bundle's module script, exactly where content-inject places it.
  return html.replace(/<script type="module"/, `${tag}<script type="module"`);
}

function hydrateTree(opts) {
  const { files } = loadDonor(DONOR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor(opts) });
  if (!out.ok) throw new Error(`hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 400)}`);
  return { donorFiles: files, files: out.files };
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
};

function serve(files) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = url === "/" ? "index.html" : url.replace(/^\//, "");
    if (!files[rel]) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(rel)] || "application/octet-stream" });
    res.end(files[rel]);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DONOR, "BOILERPLATE.json"), "utf8"));

  // 1. ESM invariant off the bytes on disk.
  {
    const bad = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (e.name.endsWith(".js") && ESM_SYNTAX.test(fs.readFileSync(full, "utf8"))) {
          bad.push(path.relative(DONOR, full));
        }
      }
    };
    walk(DONOR);
    record("ESM invariant: single self-contained bundle, no ESM syntax", bad.length === 0, bad.join(", "));
  }

  // 2. Hydration residue, optional facts present and ALL BLANK.
  let full = null;
  for (const optional of [true, false]) {
    const t = hydrateTree({ optional });
    if (optional) full = t;
    const residue = [];
    for (const [rel, buf] of Object.entries(t.files)) {
      if (!/\.(html|js|css|json|xml|txt)$/i.test(rel)) continue;
      const s = buf.toString("utf8");
      const tok = s.match(/\{\{[A-Z_]+\}\}/g);
      const need = s.match(/\[\[NEED:|\[\[\/NEED\]\]/g);
      if (tok || need) residue.push(`${rel}: ${(tok || []).slice(0, 3).join(",")}${need ? " NEED" : ""}`);
    }
    record(`hydration leaves zero token/NEED residue (optional facts ${optional ? "present" : "ALL BLANK"})`,
      residue.length === 0, residue.slice(0, 4).join(" | "));
  }

  // 3. Identity gate under the installed donor name.
  {
    const scan = identityScan(full.files, { ...manifest, name: "landscaping-evergreen" });
    record("identity gate clean (Greenfront atoms, zero hits)", scan.clean,
      scan.clean ? "0 hits" : scan.hits.slice(0, 6).map((h) => `${h.bucket}:${h.token}`).join(", "));
  }

  // 4. Photo slots: every declared slot exists AND is referenced by shipped bytes.
  {
    const shipped = Object.entries(full.files)
      .filter(([rel]) => /\.(html|js|css)$/i.test(rel))
      .map(([, buf]) => buf.toString("utf8")).join("\n");
    const missing = manifest.photo_slots.filter((p) => !full.files[p]);
    const dead = manifest.photo_slots.filter((p) => !shipped.includes(path.basename(p)));
    record("every declared photo slot is a real file", missing.length === 0, missing.join(", "));
    record("every declared photo slot is REFERENCED by the shipped html/js/css (no dead slots)",
      dead.length === 0, dead.join(", "));
  }

  // 5. RENDER THE DOM — island present, viewport desktop then mobile.
  const { chromium } = require("playwright");
  const filesWithIsland = { ...full.files };
  filesWithIsland["index.html"] = Buffer.from(withIsland(full.files["index.html"].toString("utf8")), "utf8");
  const { server, port } = await serve(filesWithIsland);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const consoleErrors = [], pageErrors = [], failed = [];
    page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message).slice(0, 200)));
    page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(400);

    const realFailed = failed.filter((f) => !/hero-client-landscaping\.mp4|brand-logo\.svg|googleusercontent\.com/.test(f));
    record("render: zero page errors, zero console errors, zero broken assets",
      pageErrors.length === 0 && consoleErrors.length === 0 && realFailed.length === 0,
      [...pageErrors, ...consoleErrors, ...realFailed].slice(0, 3).join(" | "));

    // 5a. THE H1 IS THE CLIENT'S OWN LINE — replay the exact live gate.
    const h1 = await page.locator("h1").first().innerText();
    const sameness = samenessCheck({
      slug: "wss-proof-cedar-bend",
      facts: FACTS,
      marketCity: FACTS.city,
      copy: COPY,
      donorFiles: full.donorFiles,
      files: full.files,
      renderedH1: h1,
      fleet: [],
    });
    const h1Problems = sameness.problems.filter((p) => /rendered_h1|headline_slot/.test(p));
    record("sameness gate: rendered h1 IS client-derived (the live Keane failure, cured)",
      h1Problems.length === 0, h1Problems.join(" | ") || `h1="${h1.replace(/\s+/g, " ").slice(0, 90)}"`);

    // 5b. The hero is MEASURABLE and the full-bleed IMG claim is true.
    const hero = await page.evaluate((sel) => {
      const s = document.querySelector(sel);
      if (!s) return { found: false };
      const sb = s.getBoundingClientRect();
      const img = s.querySelector("img");
      const ib = img ? img.getBoundingClientRect() : null;
      const h1el = s.querySelector("h1");
      let h1OnTop = false;
      if (h1el) {
        const hb = h1el.getBoundingClientRect();
        const probe = document.elementFromPoint(hb.left + Math.min(20, hb.width / 2), hb.top + Math.min(20, hb.height / 2));
        h1OnTop = Boolean(probe && (h1el.contains(probe) || probe.contains(h1el)));
      }
      return {
        found: true,
        heroArea: Math.round(sb.width * sb.height),
        imgCovers: Boolean(ib && ib.width >= sb.width - 2 && ib.height >= sb.height - 2),
        h1Inside: Boolean(h1el),
        h1OnTop,
      };
    }, manifest.hero_wash.selector);
    record(`mobile_fold measurability: hero_wash.selector (${manifest.hero_wash.selector}) resolves to the hero`,
      hero.found && hero.h1Inside, JSON.stringify(hero));
    record("hero_wash full-bleed claim: the design's own IMG covers the wash pixels",
      Boolean(hero.imgCovers), JSON.stringify(hero));
    record("headline resolves on top of the hero stack", Boolean(hero.h1OnTop), "");

    // 5c. The content island wins: services, faqs AND the new reviews cards.
    const body = await page.evaluate(() => document.body.innerText);
    record("island services render (verified titles, not template cards)",
      body.includes("Lawn Mowing & Edging") && body.includes("Irrigation Checks"), "");
    record("island reviews render on the design's own cards",
      body.includes("R. Alvarez") && body.includes("zero drama"), "");
    record("no template default services once the island is present",
      !body.includes("Lawn Trimming & Edging"), "template card leaked");

    // 5c2. PUNCH LIST 2026-08-20 — nav integrity, pill pair, hero ink guard,
    //      faces, motion safety, section order. Same island page.
    {
      // Every in-page anchor resolves to a rendered id (the live build had
      // #lawn-care / #landscape / #area pointing at nothing).
      const nav = await page.evaluate(() => {
        const dead = [];
        for (const a of document.querySelectorAll('a[href^="#"]')) {
          const id = a.getAttribute("href").slice(1);
          if (id && !document.getElementById(id)) dead.push("#" + id);
        }
        return dead;
      });
      record("nav integrity: every in-page anchor resolves to a rendered id", nav.length === 0, nav.join(", "));

      const relLum = ([r, g, b]) => {
        const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x);
        return (l1 + 0.05) / (l2 + 0.05);
      };
      const parseRgb = (s2) => (s2.match(/\d+(?:\.\d+)?/g) || []).slice(0, 3).map(Number);
      const comp = (fg, alpha, bg) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

      // The header phone pill: measured computed pair, standalone light.
      const pill = await page.evaluate(() => {
        const a = document.querySelector('header a[href^="tel:"]');
        const cs = getComputedStyle(a);
        return { bg: cs.backgroundColor, ink: cs.color };
      });
      const pillRatio = ratio(parseRgb(pill.bg), parseRgb(pill.ink));
      record("phone pill AA (standalone light pair)", pillRatio >= 4.5, pillRatio.toFixed(2) + ":1  " + pill.bg + " / " + pill.ink);

      // The dark-mode pair, computed from the donor's own .dark tokens:
      // primary 210 40% 98% (near-white) on ink 222.2 47.4% 11.2% (near-black).
      const hslRgb = (h, s3, l) => {
        s3 /= 100; l /= 100;
        const k = (n) => (n + h / 30) % 12;
        const a = s3 * Math.min(l, 1 - l);
        const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
      };
      const darkRatio = ratio(hslRgb(210, 40, 98), hslRgb(222.2, 47.4, 11.2));
      record("phone pill AA (donor .dark pair, static)", darkRatio >= 4.5, darkRatio.toFixed(2) + ":1");

      // HOSTILE THEME SIMULATION — the live defect: a theme pass that makes
      // BOTH primary tokens dark. The pill must follow the coherent slab pair
      // instead; the hero ink must ignore the hostile foreground entirely.
      await page.addStyleTag({ content: ":root{--primary:140 30% 10%;--primary-foreground:140 30% 12%;--wss-slab:140 30% 10%;--wss-slab-ink:60 25% 97%;}" });
      // The pill carries transition-all, so a computed read at t=0 still
      // reports the pre-injection colour; wait out the transition before
      // reading the pixels (measured: an instant read showed the fallback).
      await page.waitForTimeout(450);
      const hostile = await page.evaluate(() => {
        const a = document.querySelector('header a[href^="tel:"]');
        const cs = getComputedStyle(a);
        const h1 = document.querySelector("#top h1");
        return { bg: cs.backgroundColor, ink: cs.color, h1Ink: getComputedStyle(h1).color };
      });
      const hostileRatio = ratio(parseRgb(hostile.bg), parseRgb(hostile.ink));
      record("phone pill survives a hostile theme split (follows the slab pair, AA)",
        hostileRatio >= 4.5, hostileRatio.toFixed(2) + ":1  " + hostile.bg + " / " + hostile.ink);
      const heroInkRgb = parseRgb(hostile.h1Ink);
      const heroBg = [11, 30, 17]; // #0b1e11, the recorded hero sample
      record("hero ink guard: h1 ignores the hostile foreground and stays light over the hero sample",
        ratio(heroInkRgb, heroBg) >= 4.5, ratio(heroInkRgb, heroBg).toFixed(2) + ":1  " + hostile.h1Ink);
      // Dimmest hero ink: the /85 step at 0.88 alpha composited on the sample.
      const dimmest = comp(heroInkRgb, 0.88, heroBg);
      record("hero dimmest ink (0.88 alpha) still clears AA on the hero sample",
        ratio(dimmest, heroBg) >= 4.5, ratio(dimmest, heroBg).toFixed(2) + ":1");

      // Faces: the verified-face review renders an <img>, the faceless one an
      // initials monogram, and the Google badge sits on Google-lane reviews.
      const faces = await page.evaluate(() => {
        const sec = document.getElementById("reviews");
        const imgs = [...sec.querySelectorAll("figure img")].map((i) => i.getAttribute("src"));
        const text = sec.innerText;
        // Chrome's innerText applies text-transform, so the uppercase badge
        // reads "GOOGLE" -- match case-insensitively.
        return { imgs, hasInitials: /\bTN\b/.test(text), googleBadges: (text.match(/google/gi) || []).length };
      });
      record("review faces: verified Google face renders as an <img> (googleusercontent only)",
        faces.imgs.length === 1 && /googleusercontent\.com/.test(faces.imgs[0]), JSON.stringify(faces.imgs));
      record("review faces: faceless reviewer falls back to an initials monogram", faces.hasInitials, "");
      record("review source: 'Google' badge renders on Google-lane reviews", faces.googleBadges >= 2, faces.googleBadges + " badges");

      // Section order: Find/contact now sits ABOVE the planner.
      const order = await page.evaluate(() => {
        const est = document.getElementById("estimate");
        const plan = document.getElementById("planner");
        return Boolean(est && plan && (est.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING));
      });
      record("section order: Find/contact renders above the planner", order, "");

      // Anchor jumps clear the fixed header.
      const margin = await page.evaluate(() => getComputedStyle(document.getElementById("gallery")).scrollMarginTop);
      record("anchor targets clear the fixed header (scroll-margin-top)", margin === "80px", margin);

      // Motion safety: underline draw + chip float exist, and BOTH are fully
      // suppressed under prefers-reduced-motion.
      const motion = await page.evaluate(() => ({
        underline: getComputedStyle(document.querySelector("#top h1 em svg path")).animationName,
        chip: getComputedStyle(document.querySelector(".wss-float-chip")).animationName,
      }));
      record("motion: underline draw + chip float are armed when motion is welcome",
        motion.underline === "wss-underline-draw" && motion.chip === "wss-chip-float", JSON.stringify(motion));
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reduced = await page.evaluate(() => ({
        underline: getComputedStyle(document.querySelector("#top h1 em svg path")).animationName,
        chip: getComputedStyle(document.querySelector(".wss-float-chip")).animationName,
        offset: getComputedStyle(document.querySelector("#top h1 em svg path")).strokeDashoffset,
      }));
      record("motion: reduced motion suppresses BOTH animations and the stroke sits complete",
        reduced.underline === "none" && reduced.chip === "none" && (reduced.offset === "0" || reduced.offset === "0px"),
        JSON.stringify(reduced));
      await page.emulateMedia({ reducedMotion: "no-preference" });

      // Footer attribution.
      const attribution = await page.evaluate(() => {
        const a = [...document.querySelectorAll("footer a")].find((x) => x.href === "https://wss-ai.com/");
        return a ? a.innerText.trim() : "";
      });
      record("footer: muted 'Built by wss-ai.com' attribution links to wss-ai.com",
        attribution === "Built by wss-ai.com", attribution);
    }

    // 5d. Mobile viewport: the hero selector still resolves; page renders.
    const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mob.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 30000 });
    await mob.waitForTimeout(300);
    const mobOk = await mob.evaluate((sel) => Boolean(document.querySelector(sel) && document.querySelector(sel).querySelector("h1")), manifest.hero_wash.selector);
    record("mobile 390px: hero selector and h1 still resolve", mobOk, "");
    await mob.close();

    // 5e. NO island (standalone donor): reviews section shows the ask card only
    //     when a profile is verified; template services return as the fallback.
    const bare = { ...full.files };
    const { server: s2, port: p2 } = await serve(bare);
    const page2 = await browser.newPage();
    const errs2 = [];
    page2.on("pageerror", (e) => errs2.push(String(e && e.message).slice(0, 200)));
    await page2.goto(`http://127.0.0.1:${p2}/`, { waitUntil: "networkidle", timeout: 30000 });
    await page2.waitForTimeout(300);
    const body2 = await page2.evaluate(() => document.body.innerText);
    record("no island: template services render as the design's fallback",
      body2.includes("Lawn Trimming & Edging"), "");
    record("no island: NO invented reviews — only the review-ask card (profile verified)",
      body2.includes("Leave a Google review") && !body2.includes("R. Alvarez"), "");
    record("no island: zero page errors", errs2.length === 0, errs2.slice(0, 2).join(" | "));
    await page2.close();
    s2.close();
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  const failedChecks = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failedChecks.length}/${results.length} checks passed ===`);
  process.exit(failedChecks.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
