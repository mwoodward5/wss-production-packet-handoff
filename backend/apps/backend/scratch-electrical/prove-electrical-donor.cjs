"use strict";
/**
 * scratch-electrical/prove-electrical-donor.cjs — RENDER THE DOM, not the claim.
 *
 * Proves the installed electrical donor (donors-clean/electrical-livewire)
 * the way scratch-concrete/prove-staged-donor.cjs proved the concrete SPA:
 * disk invariants, hydration both ways, identity scan, then a real Chromium
 * render of the page on desktop and phone viewports — including the hero
 * video ladder actually ARMING on the shipped WSS fallback clip.
 *
 * Read-only outside scratch-electrical/. Writes nothing anywhere.
 *
 *   node scratch-electrical/prove-electrical-donor.cjs
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const BACKEND = path.join(__dirname, "..");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-electrical-"));

const { loadDonor } = require(path.join(BACKEND, "lib/mirror-engine/donor"));
const { hydrate } = require(path.join(BACKEND, "lib/mirror-engine/hydrate"));
const { ALLOWED_TOKENS } = require(path.join(BACKEND, "lib/mirror-engine/tokens"));
const { identityScan } = require(path.join(BACKEND, "lib/mirror-engine/scan"));

const DONOR = path.join(BACKEND, "donors-clean", "electrical-livewire");
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

function hydrateTree(opts) {
  const { files } = loadDonor(DONOR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor(opts) });
  if (!out.ok) throw new Error(`hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 300)}`);
  return out.files;
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
    await page.waitForTimeout(1200);
    const body = await page.evaluate(() => (document.body ? document.body.innerText : ""));
    const html = await page.content();
    const h1 = (await page.locator("h1").count()) ? (await page.locator("h1").first().innerText()).slice(0, 90) : "";
    const heroArmed = await page.evaluate(() => {
      const v = document.querySelector("video[data-hero-video]");
      return v ? { armed: v.getAttribute("data-hero-armed") === "1", src: v.currentSrc || v.src || "", ready: v.readyState } : null;
    });
    const report = {
      label,
      status: resp ? resp.status() : 0,
      textLen: body.trim().length,
      h1,
      heroArmed,
      consoleErrors,
      pageErrors,
      // Two assets are engine-written on a real build and absent by design:
      // ladder rung 1 (the client's own clip) and the LOGO_URL target.
      failed: failed.filter((f) => !/hero-client-electrical\.mp4|brand-logo\.svg|fonts\.googleapis|fonts\.gstatic/.test(f)),
      expectedMissing: failed.filter((f) => /hero-client-electrical\.mp4|brand-logo\.svg/.test(f)),
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
      { "x.html": Buffer.from("<html>Voltage & Valor Electric — (321) 236-3298 — voltagevalor.com</html>") },
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
  for (const [optional, files] of [[true, fullFiles], [false, hydrateTree({ optional: false })]]) {
    for (const vp of [{ width: 1280, height: 800, label: "desktop" }, { width: 390, height: 844, label: "phone" }]) {
      const r = await renderOnce(files, vp);
      const ok = r.status === 200 && r.textLen > 800 && !r.consoleErrors.length && !r.pageErrors.length &&
        !r.failed.length && !r.tokenResidue.length && !r.needResidue.length && !r.dangling &&
        Boolean(r.h1) && r.heroArmed && r.heroArmed.armed === true &&
        r.heroArmed.src.includes("hero-fallback-electrical.mp4");
      record(`render ${vp.label} (optionals ${optional ? "present" : "blank"}): 200, real text, h1, ladder ARMED on rung 2, zero errors`,
        ok,
        `status=${r.status} text=${r.textLen} h1="${r.h1}" armed=${JSON.stringify(r.heroArmed)}` +
        (r.consoleErrors.length ? ` console:${r.consoleErrors[0]}` : "") +
        (r.pageErrors.length ? ` pageerr:${r.pageErrors[0]}` : "") +
        (r.failed.length ? ` broken:${r.failed.slice(0, 3).join(" ; ")}` : "") +
        (r.dangling ? " DANGLING-CALL-PROSE" : ""));
    }
  }

  // 6. THE HERO WASH, RENDERED — pages_verified:["/"] must be a render-proven
  //    claim, not a checkbox. Apply the engine's own heroWashCss (the donor's
  //    measured spec, a real photograph) to the hydrated tree and prove in
  //    Chromium that the wash PAINTS behind the hero copy on /.
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
    files["assets/hero-proof.jpg"] = fs.readFileSync(path.join(DONOR, "assets", "work-1-CXjA8BKM.jpg"));

    const { chromium } = require("playwright");
    const { server, port } = await serve(files);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(600);
      const proof = await page.evaluate((sel) => {
        const hero = document.querySelector(sel);
        if (!hero) return { hero: false };
        const bg = getComputedStyle(hero).backgroundImage || "";
        const h1 = hero.querySelector("h1");
        const h1Style = h1 ? getComputedStyle(h1) : null;
        const h1Rect = h1 ? h1.getBoundingClientRect() : null;
        return {
          hero: true,
          washPaints: bg.includes("hero-proof.jpg"),
          scrimPresent: /gradient|rgba/.test(bg),
          h1Visible: Boolean(h1Style && h1Style.display !== "none" && h1Style.visibility !== "hidden" && h1Rect && h1Rect.width > 1 && h1Rect.height > 1),
        };
      }, spec.selector);
      record("hero wash: RENDERED on / — the photograph paints behind the hero copy and the h1 stays visible",
        proof.hero && proof.washPaints && proof.scrimPresent && proof.h1Visible, JSON.stringify(proof));
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
