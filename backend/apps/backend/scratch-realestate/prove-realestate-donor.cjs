"use strict";
/**
 * scratch-realestate/prove-realestate-donor.cjs — RENDER THE DOM, not the claim.
 *
 * Proves the installed real-estate donor (donors-clean/realestate-waterline)
 * the way scratch-electrical/prove-electrical-donor.cjs proved electrical:
 * disk invariants, hydration both ways, identity scan, then a real Chromium
 * render on desktop and phone viewports — including the hero video ladder
 * actually ARMING on the shipped WSS fallback clip, the island-only reviews
 * contract (collapse / review-ask / verified island reviews), and the
 * content-bridge services and FAQ consumption.
 *
 * Read-only outside scratch-realestate/. Writes nothing anywhere.
 *
 *   node scratch-realestate/prove-realestate-donor.cjs
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const BACKEND = path.join(__dirname, "..");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-realestate-"));

const { loadDonor } = require(path.join(BACKEND, "lib/mirror-engine/donor"));
const { hydrate } = require(path.join(BACKEND, "lib/mirror-engine/hydrate"));
const { ALLOWED_TOKENS } = require(path.join(BACKEND, "lib/mirror-engine/tokens"));
const { identityScan } = require(path.join(BACKEND, "lib/mirror-engine/scan"));

const DONOR = path.join(BACKEND, "donors-clean", "realestate-waterline");
const ESM_SYNTAX = /(^|[;}])(import|export)[{ ]|import\.meta|import\(/;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

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

function hydrateTree(opts) {
  const { files } = loadDonor(DONOR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor(opts) });
  if (!out.ok) throw new Error(`hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 300)}`);
  return out.files;
}

// The engine's content island, exactly as content-inject.js writes it:
// a JSON data island ahead of the bundle plus the one-line reader.
function withContentIsland(files, content) {
  const out = { ...files };
  const island =
    `<script id="wss-content" type="application/json">${JSON.stringify(content)}</script>` +
    `<script>try{var e=document.getElementById("wss-content");if(e)window.__WSS_CONTENT__=JSON.parse(e.textContent)}catch(x){}</script>`;
  out["index.html"] = Buffer.from(
    out["index.html"].toString("utf8").replace(/<script type="module"/, `${island}\n<script type="module"`),
    "utf8",
  );
  return out;
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
};

function serve(files) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    const tries = url === "/" ? ["index.html"] : [url.replace(/^\//, "")];
    const rel = tries.find((t) => files[t]);
    if (!rel) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(rel)] || "application/octet-stream" });
    res.end(files[rel]);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

async function renderOnce(files, { width, height, label }) {
  const { chromium } = require("playwright");
  const { server, port } = await serve(files);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const consoleErrors = [];
    const pageErrors = [];
    const failed = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text().slice(0, 300);
      if (/^Failed to load resource/.test(t)) return;
      consoleErrors.push(t);
    });
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message).slice(0, 300)));
    page.on("requestfailed", (r) => failed.push(`${r.url()} ${(r.failure() || {}).errorText || ""}`));
    page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    const resp = await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 30000 });
    // Outlast the preloader (done at 1700ms) so the DOM judged is the page,
    // not the loading veil.
    await page.waitForTimeout(2200);
    const body = await page.evaluate(() => (document.body ? document.body.innerText : ""));
    const html = await page.content();
    const h1 = (await page.locator("h1").count()) ? (await page.locator("h1").first().innerText()).slice(0, 120) : "";
    const heroArmed = await page.evaluate(() => {
      const v = document.querySelector("video[data-hero-video]");
      return v ? { armed: v.getAttribute("data-hero-armed") === "1", src: v.currentSrc || v.src || "", ready: v.readyState } : null;
    });
    const testimonialsMounted = await page.evaluate(() => Boolean(document.getElementById("testimonials")));
    const navTestimonials = await page.evaluate(() =>
      [...document.querySelectorAll('a[href="#testimonials"]')].length);
    const reviewQuotes = await page.evaluate(() =>
      [...document.querySelectorAll("#testimonials p")].map((p) => p.innerText).filter((t) => t.startsWith('"')).length);
    const collectionTitles = await page.evaluate(() =>
      [...document.querySelectorAll("#collections a p")].map((p) => p.innerText.trim()).filter(Boolean));
    const report = {
      label,
      status: resp ? resp.status() : 0,
      textLen: body.trim().length,
      h1,
      heroArmed,
      testimonialsMounted,
      navTestimonials,
      reviewQuotes,
      collectionTitles,
      body,
      consoleErrors,
      pageErrors,
      // Two assets are engine-written on a real build and absent by design:
      // ladder rung 1 (the client's own clip) and the LOGO_URL target.
      failed: failed.filter((f) => !/hero-client-realestate\.mp4|brand-logo\.svg|fonts\.googleapis|fonts\.gstatic/.test(f)),
      tokenResidue: (html.match(/\{\{[A-Z_]+\}\}/g) || []).slice(0, 5),
      needResidue: (html.match(/\[\[NEED:|\[\[\/NEED\]\]/g) || []).slice(0, 5),
      dangling: /\bcall\b\s*[.,;:·•|]|\bcall\b\s*$/im.test(
        body.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"),
      ),
    };
    await page.close();
    return report;
  } finally {
    await browser.close();
    server.close();
  }
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
    record("ESM invariant: no plain .js chunk contains ESM syntax", bad.length === 0,
      bad.length ? bad.join(", ") : "single self-contained bundle, no .js.raw sidecar");
  }

  // 2. Hydration residue, both ways.
  let fullFiles = null;
  for (const optional of [true, false]) {
    const files = hydrateTree({ optional });
    if (optional) fullFiles = files;
    const residue = [];
    for (const [rel, buf] of Object.entries(files)) {
      if (!/\.(html|js|css|json|xml|txt|webmanifest)$/i.test(rel)) continue;
      const s = buf.toString("utf8");
      const t = s.match(/\{\{[A-Z_]+\}\}/g);
      const n = s.match(/\[\[NEED:|\[\[\/NEED\]\]/g);
      if (t || n) residue.push(`${rel}: ${(t || []).slice(0, 3).join(",")}${(n || []).length ? " NEED" : ""}`);
    }
    record(`hydration leaves zero residue (optional facts ${optional ? "present" : "ALL BLANK"})`,
      residue.length === 0, residue.slice(0, 4).join(" | "));
  }

  // 3. Identity gate: armed and clean.
  {
    const dirty = identityScan(
      { "x.html": Buffer.from("<html>JRE Realty — Renobeast & Renocarmen — Coconut Grove, Miami — (305) 555-0100</html>") },
      manifest,
    );
    record("identity gate is ARMED (source residue is caught)", dirty.clean === false,
      dirty.clean ? "the atoms are inert!" : `${dirty.hits.length} hits on planted residue`);
    const scan = identityScan(fullFiles, manifest);
    record("identity gate clean on the hydrated tree", scan.clean,
      scan.clean ? "0 hits" : JSON.stringify(scan.hits.slice(0, 6)));
  }

  // 4. Photo slots exist in the hydrated tree.
  {
    const missing = manifest.photo_slots.filter((p) => !fullFiles[p]);
    record("every declared photo slot is a real file in the hydrated tree", missing.length === 0, missing.join(", "));
  }

  // 5. RENDER THE DOM — desktop and phone, optionals present and blank.
  //    Optionals PRESENT (no island reviews, verified profile): the honest
  //    review-ask card renders and the nav links to it.
  //    Optionals BLANK (no reviews, no profile): the testimonials section AND
  //    its nav links collapse.
  for (const [optional, files] of [[true, fullFiles], [false, hydrateTree({ optional: false })]]) {
    for (const vp of [{ width: 1280, height: 800, label: "desktop" }, { width: 390, height: 844, label: "phone" }]) {
      const r = await renderOnce(files, vp);
      // innerText reflects text-transform, so the uppercase CTA is matched
      // case-insensitively.
      const reviewsContractOk = optional
        ? r.testimonialsMounted && r.navTestimonials >= 1 && r.body.toLowerCase().includes("leave a google review")
        : !r.testimonialsMounted && r.navTestimonials === 0;
      const ok = r.status === 200 && r.textLen > 800 && !r.consoleErrors.length && !r.pageErrors.length &&
        !r.failed.length && !r.tokenResidue.length && !r.needResidue.length && !r.dangling &&
        Boolean(r.h1) && r.heroArmed && r.heroArmed.armed === true &&
        r.heroArmed.src.includes("hero-fallback-realestate.mp4") && reviewsContractOk;
      record(`render ${vp.label} (optionals ${optional ? "present" : "blank"}): 200, real text, h1, ladder ARMED on rung 2, reviews contract, zero errors`,
        ok,
        `status=${r.status} text=${r.textLen} h1="${r.h1}" armed=${JSON.stringify(r.heroArmed)} testimonials=${r.testimonialsMounted} navLinks=${r.navTestimonials}` +
        (r.consoleErrors.length ? ` console:${r.consoleErrors[0]}` : "") +
        (r.pageErrors.length ? ` pageerr:${r.pageErrors[0]}` : "") +
        (r.failed.length ? ` broken:${r.failed.slice(0, 3).join(" ; ")}` : "") +
        (r.dangling ? " DANGLING-CALL-PROSE" : ""));
    }
  }

  // 6. THE CONTENT BRIDGE, RENDERED — verified island reviews on the rotating
  //    frame, verified services on the collections mosaic, verified FAQs in
  //    the accordion. consumes_content must be true in deed, not just in JSON.
  {
    const island = {
      version: "wss-content-v1",
      services: [
        { name: "Waterfront Buyer Advisory", description: "Representation for water-access purchases." },
        { name: "Listing Strategy" },
      ],
      faqs: [{ q: "Which markets do you cover?", a: "Sarasota and the barrier islands." }],
      reviews: [
        { author: "Dana W.", text: "Calm, prepared, and relentless on the details.", rating: 5, publishedAt: "2026-05-01" },
        { author: "M. Ortiz", text: "Sold above asking in nine days.", rating: 5 },
      ],
    };
    const files = withContentIsland(hydrateTree({ optional: true }), island);
    const r = await renderOnce(files, { width: 1280, height: 800, label: "bridge" });
    const gotReview = r.body.includes("Calm, prepared, and relentless on the details.");
    const gotService = r.collectionTitles.includes("Waterfront Buyer Advisory");
    const gotFaq = r.body.includes("Which markets do you cover?");
    const noTemplateQuote = !r.body.includes("Hartwell") && !r.body.includes("Castellano") && !r.body.includes("Beaumont");
    record("content bridge: island reviews, services and FAQs render; no template testimonial exists to leak",
      gotReview && gotService && gotFaq && noTemplateQuote && r.reviewQuotes >= 1 && !r.pageErrors.length,
      `review=${gotReview} service=${gotService} faq=${gotFaq} quotes=${r.reviewQuotes} collections=${JSON.stringify(r.collectionTitles.slice(0, 3))}`);
  }

  // 7. THE HERO WASH — apply the engine's own heroWashCss (the donor's
  //    measured spec, a real photograph) to the hydrated tree and prove in
  //    Chromium that the spec applies, clears AA, and the h1 stays visible.
  //    pages_verified is [] by design: the design's own full-bleed hero IMG
  //    owns the visible pixels on the only route (the landscaping shape).
  {
    const { heroWashCss, AA_NORMAL } = require(path.join(BACKEND, "lib/hero-wash"));
    const spec = manifest.hero_wash;
    const wash = heroWashCss({
      imageHref: "/assets/hero-proof.jpg",
      accent: spec.background,
      scrimHex: spec.background,
      textHex: spec.text_color,
      selectors: [spec.selector],
    });
    record("hero wash: heroWashCss applies the donor spec and clears AA", wash.applied && wash.worstCaseRatio >= AA_NORMAL,
      `applied=${wash.applied} worst=${wash.worstCaseRatio}:1`);

    const files = { ...hydrateTree({ optional: true }) };
    const cssRel = Object.keys(files).find((r) => /\.css$/i.test(r));
    files[cssRel] = Buffer.from(files[cssRel].toString("utf8") + "\n" + wash.css, "utf8");
    files["assets/hero-proof.jpg"] = fs.readFileSync(path.join(DONOR, "assets", "lifestyle-interior-C6rlevbM.jpg"));

    const { chromium } = require("playwright");
    const { server, port } = await serve(files);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(2200);
      const proof = await page.evaluate((sel) => {
        const hero = document.querySelector(sel);
        if (!hero) return { hero: false };
        const bg = getComputedStyle(hero).backgroundImage || "";
        const h1 = hero.querySelector("h1");
        const h1Style = h1 ? getComputedStyle(h1) : null;
        const h1Rect = h1 ? h1.getBoundingClientRect() : null;
        const img = hero.querySelector("img");
        return {
          hero: true,
          washApplied: bg.includes("hero-proof.jpg"),
          scrimPresent: /gradient|rgba/.test(bg),
          designImgCoversWash: Boolean(img && img.getBoundingClientRect().width >= hero.getBoundingClientRect().width - 2),
          h1Visible: Boolean(h1Style && h1Style.display !== "none" && h1Style.visibility !== "hidden" && h1Rect && h1Rect.width > 1 && h1Rect.height > 1),
        };
      }, spec.selector);
      record("hero wash: RENDERED on / — spec lands on section#top, the design's full-bleed img owns the pixels, h1 stays visible",
        proof.hero && proof.washApplied && proof.scrimPresent && proof.designImgCoversWash && proof.h1Visible, JSON.stringify(proof));
      await page.close();
    } finally {
      await browser.close();
      server.close();
    }
  }

  const failedChecks = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failedChecks.length}/${results.length} checks passed ===`);
  process.exit(failedChecks.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
