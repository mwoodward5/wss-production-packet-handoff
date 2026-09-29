"use strict";
/**
 * scratch-concrete/prove-staged-donor.cjs — RENDER THE DOM, not the claim.
 *
 * Proves the staged client-SPA concrete donor against the same checks the
 * library's own tests apply, and renders every route in a real browser. The
 * SHIPPING SSG donor is rendered by the identical harness as the control, so
 * any difference is attributable to the donor and not to the harness.
 *
 * Read-only on donors-clean. Writes nothing outside scratch-concrete/.
 *
 *   node scratch-concrete/prove-staged-donor.cjs
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const BACKEND = path.join(__dirname, "..");
// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-concrete-spa-"));

const { loadDonor } = require(path.join(BACKEND, "lib/mirror-engine/donor"));
const { hydrate } = require(path.join(BACKEND, "lib/mirror-engine/hydrate"));
const { ALLOWED_TOKENS } = require(path.join(BACKEND, "lib/mirror-engine/tokens"));
const { identityScan } = require(path.join(BACKEND, "lib/mirror-engine/scan"));

const STAGED = path.join(__dirname, "donor-staging", "concrete-elconstruction-spa");
const SHIPPING = path.join(BACKEND, "donors-clean", "concrete-elconstruction");

const ESM_SYNTAX = /(^|[;}])(import|export)[{ ]|import\.meta|import\(/;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// Token sets
// ---------------------------------------------------------------------------
function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Granite Ridge Concrete",
    CITY: "Boise", ADDRESS_CITY: "Boise", STATE: "ID", REGION: "ID",
    HERO_HEADLINE: "Concrete contractors who quote it in writing.",
    HERO_LINE_A: "Granite Ridge Concrete",
    HERO_LINE_B: "Concrete in Boise, ID",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(208) 555-0161", PHONE_DIGITS: "2085550161",
      EMAIL: "hello@example.com", PROFILE_URL: "https://maps.google.com/?cid=1",
      RATING: "4.7", REVIEW_COUNT: "64", LICENSE: "ID-C-2231",
      GEO_LAT: "43.6150", GEO_LNG: "-116.2023",
    });
  }
  return tv;
}

function hydrateTree(dir, opts) {
  const { files } = loadDonor(dir);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor(opts) });
  if (!out.ok) throw new Error(`hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 300)}`);
  return out.files;
}

// ---------------------------------------------------------------------------
// Static server that mimics deploy.js: cleanUrls + spa rewrites to "/"
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
};

function serve(files, spaRoutes) {
  const rewrites = new Set(spaRoutes);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    const tries = url === "/" ? ["index.html"] : [
      url.replace(/^\//, ""),                       // exact file
      `${url.replace(/^\//, "")}/index.html`,       // SSG subfolder index
      `${url.replace(/^\//, "")}.html`,             // cleanUrls
    ];
    let rel = tries.find((t) => files[t]);
    if (!rel && rewrites.has(url)) rel = "index.html";   // injected SPA rewrite -> "/"
    if (!rel) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(rel)] || "application/octet-stream" });
    res.end(files[rel]);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

// ---------------------------------------------------------------------------
// Render every route in chromium and report what the browser actually saw
// ---------------------------------------------------------------------------
async function renderAll(label, files, routes, spaRoutes) {
  const { chromium } = require("playwright");
  const { server, port } = await serve(files, spaRoutes);
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const route of routes) {
      const page = await browser.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failed = [];
      // "Failed to load resource" carries no URL; the response listener below
      // records every >=400 WITH its URL, so drop the blind duplicate.
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text().slice(0, 300);
        if (/^Failed to load resource/.test(t)) return;
        consoleErrors.push(t);
      });
      page.on("pageerror", (e) => pageErrors.push(String(e && e.message).slice(0, 300)));
      page.on("requestfailed", (r) => failed.push(`${r.url()} ${(r.failure() || {}).errorText || ""}`));
      // A 404 is a RESPONSE, not a requestfailed — the class that hid dead
      // assets behind a green build. Record it explicitly.
      page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
      const resp = await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "networkidle", timeout: 30000 });
      // Give the client router a beat to mount on a pure SPA.
      await page.waitForTimeout(400);
      const body = await page.evaluate(() => document.body ? document.body.innerText : "");
      const html = await page.content();
      report.push({
        route,
        status: resp ? resp.status() : 0,
        textLen: body.trim().length,
        h1: (await page.locator("h1").count()) ? (await page.locator("h1").first().innerText()).slice(0, 80) : "",
        consoleErrors, pageErrors,
        // Two assets are written by the ENGINE on a real build and are absent
        // from a bare donor tree by design: ladder rung 1 (the client's own
        // approved clip) and the client logo the LOGO_URL token points at.
        // Everything else is a real broken asset.
        failed: failed.filter((f) => !/hero-client-concrete\.mp4|brand-logo\.svg/.test(f)),
        expectedMissing: failed.filter((f) => /hero-client-concrete\.mp4|brand-logo\.svg/.test(f)),
        tokenResidue: (html.match(/\{\{[A-Z_]+\}\}/g) || []).slice(0, 5),
        needResidue: (html.match(/\[\[NEED:|\[\[\/NEED\]\]/g) || []).slice(0, 5),
        hydrationError: [...consoleErrors, ...pageErrors].some((t) => /Minified React error #(418|423|425)|hydrat/i.test(t)),
      });
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { label, report };
}

function summarise({ label, report }) {
  const bad = report.filter((r) =>
    r.status !== 200 || r.textLen < 400 || r.consoleErrors.length || r.pageErrors.length ||
    r.failed.length || r.tokenResidue.length || r.needResidue.length);
  console.log(`\n--- ${label}: ${report.length} routes rendered ---`);
  for (const r of report) {
    console.log(
      `  ${r.status} ${String(r.textLen).padStart(6)} chars  ${r.route.padEnd(26)} ` +
      `pageerr:${r.pageErrors.length} broken:${r.failed.length} expectedMissing:${r.expectedMissing.length} ` +
      `tok:${r.tokenResidue.length} need:${r.needResidue.length}${r.hydrationError ? "  HYDRATION-ERROR" : ""}`);
    for (const e of r.pageErrors.slice(0, 3)) console.log(`        ! ${e}`);
    for (const f of r.failed.slice(0, 3)) console.log(`        x ${f}`);
  }
  return bad;
}

// ---------------------------------------------------------------------------
(async () => {
  const stagedManifest = JSON.parse(fs.readFileSync(path.join(STAGED, "BOILERPLATE.json"), "utf8"));

  // 1. ESM invariant, read off the bytes on disk.
  {
    const bad = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (e.name.endsWith(".js")) {
          const s = fs.readFileSync(full, "utf8");
          if (ESM_SYNTAX.test(s)) bad.push(path.relative(STAGED, full));
        }
      }
    };
    walk(STAGED);
    record("ESM invariant: no plain .js chunk contains ESM syntax", bad.length === 0,
      bad.length ? `ESM in ${bad.join(", ")}` : "single self-contained bundle, no .js.raw sidecar needed");
  }

  // 2. Hydration leaves no residue, with and without the optional facts.
  let fullFiles = null;
  for (const optional of [true, false]) {
    const files = hydrateTree(STAGED, { optional });
    if (optional) fullFiles = files;
    const residue = [];
    for (const [rel, buf] of Object.entries(files)) {
      if (!/\.(html|js|css|json|xml|txt|webmanifest)$/i.test(rel)) continue;
      const s = buf.toString("utf8");
      const t = s.match(/\{\{[A-Z_]+\}\}/g);
      const n = s.match(/\[\[NEED:|\[\[\/NEED\]\]/g);
      if (t || n) residue.push(`${rel}: ${(t || []).slice(0, 3).join(",")}${(n || []).length ? " NEED" : ""}`);
    }
    record(`hydration leaves zero {{TOKEN}} / NEED residue (optional facts ${optional ? "present" : "ALL BLANK"})`,
      residue.length === 0, residue.slice(0, 4).join(" | "));
  }

  // 3. Identity gate — under the staged name AND under the shipping name.
  for (const name of ["concrete-elconstruction-spa", "concrete-elconstruction"]) {
    const scan = identityScan(fullFiles, { ...stagedManifest, name });
    record(`identity gate clean under donor name "${name}"`, scan.clean,
      scan.clean ? "0 hits" : `${scan.hits.length} hits: ${scan.hits.slice(0, 6).map((h) => `${h.bucket}:${h.token}`).join(", ")}`);
  }

  // 4. Declared photo slots all exist in the hydrated tree.
  {
    const missing = stagedManifest.photo_slots.filter((p) => !fullFiles[p]);
    record("every declared photo slot is a real file in the hydrated tree", missing.length === 0, missing.join(", "));
  }

  // 5. spa_routes precondition: each declared route has NO file behind it.
  {
    const shadowed = stagedManifest.spa_routes.filter((r) => {
      const rel = r.replace(/^\//, "");
      return Boolean(fullFiles[rel] || fullFiles[`${rel}/index.html`] || fullFiles[`${rel}.html`]);
    });
    record("deepLinkCheck precondition: no declared spa_route is shadowed by a real file",
      shadowed.length === 0, shadowed.join(", "));
  }

  // 6. INSTALL REHEARSAL — a throwaway donor root containing ONLY this tree,
  //    under the name it would be installed as. Proves the engine's own
  //    resolution, the alias layer and the console's vertical list all pick it
  //    up, WITHOUT touching donors-clean.
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "donor-root-rehearsal-"));
    const asName = path.join(root, "concrete-elconstruction");
    fs.cpSync(STAGED, asName, { recursive: true });

    // GOTCHA, proven below before it is corrected: listDonors() builds each
    // entry as { name: <directory>, ...manifest } — the manifest's own `name`
    // WINS. resolveDonor() then does path.join(root, match.name), so a manifest
    // whose name disagrees with its directory resolves to a directory that does
    // not exist: readManifest() returns {}, the identity gate goes inert (no
    // atoms => passes any bytes) and loadDonor throws on a path nobody chose.
    // The install step MUST rewrite this field.
    {
      const asShipped = JSON.parse(fs.readFileSync(path.join(asName, "BOILERPLATE.json"), "utf8"));
      const drifted = asShipped.name !== "concrete-elconstruction";
      record("install rehearsal: manifest.name drift is caught BEFORE install (it must equal the directory)",
        drifted, drifted
          ? `staged manifest says "${asShipped.name}" — the install step rewrites it to the directory name`
          : "no drift to catch");
      asShipped.name = "concrete-elconstruction";
      fs.writeFileSync(path.join(asName, "BOILERPLATE.json"), JSON.stringify(asShipped, null, 2) + "\n");
    }

    delete require.cache[require.resolve(path.join(BACKEND, "lib/mirror-engine/donor"))];
    const { resolveDonor, listDonors, preferredDonorFor } = require(path.join(BACKEND, "lib/mirror-engine/donor"));
    const { resolveAlias, liveVerticals } = require(path.join(BACKEND, "lib/donor-verticals"));
    const { buildableVerticals } = require(path.join(BACKEND, "lib/buildable-verticals"));

    const byVertical = resolveDonor({ industry: "concrete" }, root);
    record("install rehearsal: resolveDonor({industry:'concrete'}) finds it",
      byVertical.ok && byVertical.name === "concrete-elconstruction",
      byVertical.ok ? byVertical.name : `${byVertical.error} ${JSON.stringify(byVertical.detail)}`);

    const alias = resolveAlias("masonry", { root });
    record("install rehearsal: the masonry/hardscaping alias still routes to it",
      Boolean(alias && alias.donor === "concrete-elconstruction"), JSON.stringify(alias));

    const verticals = buildableVerticals({ root });
    record("install rehearsal: the console's buildable-vertical list offers concrete",
      verticals.some((v) => v.vertical === "concrete" && v.donor === "concrete-elconstruction"),
      JSON.stringify(verticals));

    record("install rehearsal: canonical table already points at this donor name",
      preferredDonorFor("concrete") === "concrete-elconstruction", preferredDonorFor("concrete"));

    record("install rehearsal: 'concrete' is a LIVE vertical the engine owns (alias table can never shadow it)",
      liveVerticals(root).has("concrete"), [...liveVerticals(root)].join(","));

    fs.rmSync(root, { recursive: true, force: true });
    delete require.cache[require.resolve(path.join(BACKEND, "lib/mirror-engine/donor"))];
    void listDonors;
  }

  // 7. RENDER THE DOM — staged donor, then the shipping donor as the control.
  const staged = await renderAll("STAGED client-SPA", fullFiles, stagedManifest.routes, stagedManifest.spa_routes);
  const badStaged = summarise(staged);
  record("staged donor: all routes render 200 with real body text, zero errors, zero residue",
    badStaged.length === 0, badStaged.map((r) => r.route).join(", "));

  const shipManifest = JSON.parse(fs.readFileSync(path.join(SHIPPING, "BOILERPLATE.json"), "utf8"));
  const shipFiles = hydrateTree(SHIPPING, { optional: true });
  const shipped = await renderAll("SHIPPING SSG (control)", shipFiles, shipManifest.routes, shipManifest.spa_routes || []);
  const badShipped = summarise(shipped);
  console.log(`\ncontrol summary: ${badShipped.length} of ${shipped.report.length} SSG routes had a finding` +
    `${badShipped.length ? ` (${badShipped.map((r) => r.route).join(", ")})` : ""}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
