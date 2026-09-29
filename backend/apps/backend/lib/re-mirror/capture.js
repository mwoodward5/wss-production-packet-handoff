"use strict";

// lib/re-mirror/capture.js — RE-MIRROR LANE, STEP 1: CAPTURE THEIR REAL SITE.
//
// Owner decision 2026-07-31: option 2. The product is the prospect's OWN site,
// captured and re-skinned — not a donor template hydrated with their facts.
// This module is the seam the whole lane hangs off, so it does one job only:
// take a live URL and produce a self-contained, offline-renderable file tree.
//
// WHY PLAYWRIGHT AND NOT A PLAIN FETCH. Most weak local sites are exactly the
// ones we target, and a large share are Wix/GoDaddy/Squarespace — where the
// markup that matters is assembled by JavaScript at runtime. `curl` gets a
// near-empty shell. We capture the RENDERED DOM plus every asset the page
// actually requested, which is the only definition of "their site" that
// survives a rebuild.
//
// WHAT THIS DELIBERATELY DOES NOT DO YET (each is its own step, on purpose):
//   · sanitise (strip trackers/analytics/their old form endpoints)
//   · third-party asset triage (licensed stock, webfonts we may not re-host)
//   · re-skin / razzle-dazzle pass
//   · rewire forms to /api/quote-request, inject Riley, schema, llms.txt
// Capture must be boring and complete first; everything downstream is a
// transform over a tree we can diff. Mixing them is how the donor lane got
// unauditable.
//
// LEGAL/TRUTH BOUNDARY, recorded here because it is easy to lose later:
// re-mirroring INVERTS the donor lane's identity rule. On the donor lane, the
// prospect's identity was the thing we injected and the donor's was the leak.
// Here their identity is the POINT and must survive intact; the leak risk moves
// to third-party material embedded in their page — stock photography they
// licensed, webfonts, a competitor's logo in a "brands we work with" strip.
// Those get triaged, not shipped blind.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 45000;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;

function playwright() {
  // Resolved lazily so requiring this module never costs a browser launch.
  return require("playwright");
}

/** Everything a captured asset needs to be re-served and audited later. */
function assetRecord(url, status, contentType, bytes, rel) {
  return { url, status, contentType: contentType || "", bytes: bytes ? bytes.length : 0, rel };
}

/** Map a remote URL onto a local, collision-free, extension-preserving path. */
function localPathFor(rawUrl, seen) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let p = decodeURIComponent(u.pathname).replace(/^\/+/, "");
  if (!p || p.endsWith("/")) p += "index.html";
  // Query-string variants are DIFFERENT assets (?v=2 cache-busting is common on
  // the builders we target); fold the query into the filename so they cannot
  // overwrite each other.
  if (u.search) {
    const ext = path.extname(p);
    const stem = ext ? p.slice(0, -ext.length) : p;
    const tag = Buffer.from(u.search).toString("base64url").slice(0, 10);
    p = `${stem}.${tag}${ext}`;
  }
  p = p.split("/").map((s) => s.replace(/[<>:"|?*\\]/g, "_")).join("/");
  let rel = `_assets/${u.host}/${p}`;
  let n = 1;
  while (seen.has(rel) && seen.get(rel) !== rawUrl) {
    const ext = path.extname(rel);
    rel = `${ext ? rel.slice(0, -ext.length) : rel}~${n++}${ext}`;
  }
  seen.set(rel, rawUrl);
  return rel;
}

/**
 * captureSite({ url, outDir, viewport, timeoutMs })
 *
 * Returns { ok, url, finalUrl, outDir, html, assets[], failures[], stats }.
 * Never throws for a site-side condition — a prospect's broken site is data,
 * not an exception, and the miner already treats a dead site as a strong lead.
 */
async function captureSite({ url, outDir, viewport = { width: 1440, height: 900 }, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { chromium } = playwright();
  const seen = new Map();
  const assets = [];
  const failures = [];
  const bodies = new Map(); // url -> {buf, rel}

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" });
  const page = await ctx.newPage();

  page.on("response", async (res) => {
    try {
      const rurl = res.url();
      if (!/^https?:/.test(rurl) || bodies.has(rurl)) return;
      const ct = res.headers()["content-type"] || "";
      if (/^text\/html/i.test(ct) && rurl === url) return; // the document itself is saved separately
      const buf = await res.body().catch(() => null);
      if (!buf || buf.length > MAX_ASSET_BYTES) return;
      const rel = localPathFor(rurl, seen);
      if (!rel) return;
      bodies.set(rurl, { buf, rel });
      assets.push(assetRecord(rurl, res.status(), ct, buf, rel));
    } catch { /* an asset we cannot read is a failure, not a crash */ }
  });
  page.on("requestfailed", (req) => failures.push({ url: req.url(), reason: (req.failure() || {}).errorText || "failed" }));

  let finalUrl = url;
  let html = "";
  let ok = true;
  let httpStatus = null;
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    httpStatus = resp ? resp.status() : null;
    // Force lazy content: most of these sites reveal imagery on scroll.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80));
      }
      window.scrollTo(0, 0);
      document.querySelectorAll("img[loading=lazy]").forEach((i) => { i.loading = "eager"; });
      await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
    });
    await page.waitForTimeout(900);
    finalUrl = page.url();
    html = await page.content();          // the RENDERED DOM, not the served shell
  } catch (e) {
    ok = false;
    failures.push({ url, reason: String((e && e.message) || e).slice(0, 200) });
  }
  await browser.close();

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const [, { buf, rel }] of bodies) {
      const dest = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }
    // Rewrite absolute asset URLs to their local copies so the tree renders
    // with the network off. Longest-first prevents a shorter URL that is a
    // prefix of a longer one from corrupting it.
    let rewritten = html;
    const urls = [...bodies.keys()].sort((a, b) => b.length - a.length);
    let rewrites = 0;
    for (const rurl of urls) {
      const rel = bodies.get(rurl).rel;
      const before = rewritten;
      rewritten = rewritten.split(rurl).join("/" + rel);
      if (rewritten !== before) rewrites++;
    }
    fs.writeFileSync(path.join(outDir, "index.html"), rewritten, "utf8");
    fs.writeFileSync(path.join(outDir, "capture-manifest.json"), JSON.stringify({
      capturedFrom: url, finalUrl, httpStatus, assetCount: assets.length,
      rewrittenAssetUrls: rewrites, failures: failures.length, assets, failures,
    }, null, 2) + "\n", "utf8");
  }

  const byType = {};
  for (const a of assets) {
    const k = (a.contentType.split(";")[0] || "unknown").trim();
    byType[k] = (byType[k] || 0) + 1;
  }
  return {
    ok, url, finalUrl, httpStatus, outDir, html,
    assets, failures,
    stats: { assetCount: assets.length, htmlBytes: Buffer.byteLength(html), failures: failures.length, byType },
  };
}

module.exports = { captureSite, localPathFor };
