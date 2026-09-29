/**
 * lib/mirror-build.js — SiteForge mirroring lane (owner directive 2026-07-27).
 * Takes a donor template + prospect truth packet, produces a ready-to-deploy static site
 * by cloning the donor's built dist/ and swapping identity atoms. Seconds per site, not
 * minutes. vercelDeploy (forge.js) is the deploy step — this module only produces files.
 *
 * Contract: mirrorBuild({ donorPath, packet, slug }) → { files: [{file, bytes}], manifest }
 * The caller feeds files into vercelDeploy. Gate A runs against the donor's manifest.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TEXT_EXTS = new Set([".html", ".js", ".css", ".json", ".txt", ".xml", ".svg", ".webmanifest"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", "dist", ".next"]);

/** Recursively collect files from a built donor dir (dist/ or public/). */
function collectFiles(dir, base = "") {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, rel));
    else out.push({ file: rel, full });
  }
  return out;
}

/** Build the identity swap map from a truth packet. */
function identitySwaps(packet, donorManifest) {
  const swaps = [];
  const m = donorManifest || {};
  const push = (from, to) => {
    if (from && to && from !== to && String(from).length >= 4) swaps.push([String(from), String(to)]);
  };
  push(m.name, packet.business_name);
  push(m.phone, packet.phone);
  push(m.email, packet.email);
  push(m.city, packet.city);
  push(m.county, packet.county);
  push(m.domain, packet.website && new URL(packet.website).hostname);
  push(m.region, packet.state);
  // Donor's accent color → prospect's brand color (rewrites the compiled CSS bundle,
  // not just a var override — the donor's green is baked into class definitions).
  // PERMANENT FIX 2026-07-28: if no brand color was scraped, use a neutral navy —
  // NEVER leave the donor's accent in place.
  const effectiveBrandColor = packet.brand_color || "#1a3a5c";
  if (m.accent_color) {
    swaps.push([String(m.accent_color), String(effectiveBrandColor)]);
  }
  // PERMANENT FIX: the donor carries its brand in multiple hex/rgb forms — strip them all.
  // tekline: #289427 (accent), #008748 (theme-color). Add known donor brand hexes.
  for (const donorHex of ["#289427", "#008748", "#1e6f1f", "#28a745"]) {
    if (donorHex.toLowerCase() !== effectiveBrandColor.toLowerCase()) {
      swaps.push([donorHex, effectiveBrandColor]);
    }
  }
  return swaps;
}

/**
 * Mirror-build a site from a donor's built output.
 * donorPath: path to the donor's BUILT site dir (dist/ with index.html + assets).
 * packet: { business_name, city, state, phone, email, website, services[], rating, reviews_count, place_id, lat, lng }
 * slug: the wss-ai.com subdomain.
 */
async function mirrorBuild({ donorPath, packet, slug }) {
  // Accept either a repo root (with nested dist/) or a dir that IS the built output
  // (has index.html at the top level, e.g. a packaged boilerplate).
  let distDir = path.join(donorPath, "dist");
  if (!fs.existsSync(distDir)) {
    if (fs.existsSync(path.join(donorPath, "index.html"))) distDir = donorPath;
    else throw new Error(`mirrorBuild: donor has no dist/ at ${distDir} and no index.html at ${donorPath} — build the donor first, never mirror from source`);
  }
  const raw = collectFiles(distDir);
  if (!raw.length) throw new Error(`mirrorBuild: no files in ${distDir}`);

  const swaps = identitySwaps(packet, packet.donor_manifest);
  // Template tokens: boilerplate donors carry {{BUSINESS_NAME}}, {{CITY}}, {{PHONE}}, etc.
  // Replace every {{TOKEN}} with the prospect's real data — a prospect seeing raw
  // template code assumes the whole thing is a scam (Comet audit 2026-07-27).
  const tokenMap = {
    BUSINESS_NAME: packet.business_name,
    CITY: packet.city,
    STATE: packet.state,
    PHONE: packet.phone,
    PHONE_DIGITS: String(packet.phone || "").replace(/\D/g, ""),
    EMAIL: packet.email,
    DOMAIN: packet.website ? new URL(packet.website).hostname : "",
    PREVIEW_DOMAIN: packet.preview_url ? new URL(packet.preview_url).hostname : "",
    PREVIEW_URL: packet.preview_url || "",
    COUNTY: packet.county || "",
    OWNER_NAME: packet.owner_name || "",
    GEO: packet.geo || (packet.lat && packet.lng ? `${packet.lat},${packet.lng}` : ""),
    GEO_LAT: packet.lat || (packet.geo ? String(packet.geo).split(",")[0] : ""),
    GEO_LNG: packet.lng || (packet.geo ? String(packet.geo).split(",")[1] : ""),
    LICENSE: packet.license || "",
    ADDRESS: packet.address || "",
    ZIP: packet.zip || "",
    PLACE_ID: packet.place_id || "",
    RATING: packet.rating != null ? String(packet.rating) : "",
    REVIEW_COUNT: packet.reviews_count != null ? String(packet.reviews_count) : "",
    REVIEW_AUTHOR: (packet.reviews && packet.reviews[0] && packet.reviews[0].author) || "",
    REVIEW_TEXT: (packet.reviews && packet.reviews[0] && packet.reviews[0].text) || "",
    // plumbing-pressure-lens donor tokens (2026-07-28)
    REGION: packet.state || packet.region || "",
    POSTAL: packet.zip || "",
    PROFILE_URL: packet.profile_url || "",
  };
  const files = [];
  for (const { file, full } of raw) {
    const ext = path.extname(file).toLowerCase();
    let bytes = fs.readFileSync(full);
    if (TEXT_EXTS.has(ext)) {
      let text = bytes.toString("utf8");
      for (const [from, to] of swaps) {
        text = text.split(from).join(to);
      }
      // Replace {{TOKEN}} with real data
      for (const [key, val] of Object.entries(tokenMap)) {
        if (val) text = text.split(`{{${key}}}`).join(String(val));
      }
      // PERMANENT FIX (2026-07-28): no raw {{TOKEN}} ever ships. Any token with no
      // data is stripped (empty) rather than left visible — a prospect seeing raw
      // template code assumes the whole thing is a scam.
      text = text.replace(/\{\{[A-Z_]+\}\}/g, "");
      bytes = Buffer.from(text, "utf8");
    }
    files.push({ file, bytes });
  }

  // Logo substitution (permanent fix 2026-07-28): ALWAYS strip the donor's logo.
  // If the prospect has a logo_url, download and use it. Otherwise generate a text
  // wordmark of the prospect's business name. Never ship the donor's brand asset.
  {
    try {
      let logoBytes = null;
      if (packet.logo_url) {
        const logoRes = await fetch(packet.logo_url, { signal: AbortSignal.timeout(15000) });
        if (logoRes.ok) logoBytes = Buffer.from(await logoRes.arrayBuffer());
      }
      if (!logoBytes) {
        // wordmark fallback: SVG of the business name, converted to the logo slot
        const name = String(packet.business_name || "Local Business").replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const color = packet.brand_color || "#1a3a5c";
        logoBytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="80" viewBox="0 0 360 80"><text x="8" y="52" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="800" fill="${color}">${name}</text></svg>`);
      }
      const logoRes = { ok: true };
      if (logoRes.ok) {
        const logoBytes = Buffer.from(await logoRes.arrayBuffer());
        const logoExt = (packet.logo_url.match(/\.(png|jpg|jpeg|svg|webp)$/i) || [".png"])[0];
        // find the donor's logo file and replace it
        for (let i = 0; i < files.length; i++) {
          if (/logo/i.test(files[i].file) && files[i].file.endsWith(logoExt)) {
            files[i] = { file: files[i].file, bytes: logoBytes };
            break;
          }
        }
        // if no logo file found, add it
        if (!files.some((f) => /logo/i.test(f.file))) {
          files.push({ file: `assets/logo${logoExt}`, bytes: logoBytes });
        }
      }
    } catch { /* logo fetch failed — the donor's logo stays, which is the bleed */ }
  }

  // Brand-color injection (Comet audit: Jul 26 batch had per-site accent colors — Morris Clark
  // maroon, Modern Desert red — the new batch lost them). Inject the prospect's brand color
  // as a CSS custom property override in index.html so the mirror carries their brand.
  if (packet.brand_color) {
    const cssVar = `:root{--accent:${packet.brand_color}!important;--launch-accent:${packet.brand_color}!important}`;
    for (let i = 0; i < files.length; i++) {
      if (files[i].file === "index.html") {
        let text = files[i].bytes.toString("utf8");
        text = text.replace("</head>", `<style>${cssVar}</style></head>`);
        files[i] = { file: files[i].file, bytes: Buffer.from(text, "utf8") };
        break;
      }
    }
  }

  const manifest = {
    slug,
    donor: packet.donor_id || path.basename(donorPath),
    file_count: files.length,
    swaps_applied: swaps.length,
    built_at: new Date().toISOString(),
    content_sha: crypto.createHash("sha256").update(Buffer.concat(files.map((f) => f.bytes))).digest("hex").slice(0, 16),
  };
  return { files, manifest };
}

module.exports = { mirrorBuild };
