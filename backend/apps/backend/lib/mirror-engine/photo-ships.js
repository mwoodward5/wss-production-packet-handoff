"use strict";

// lib/mirror-engine/photo-ships.js — EVERY EMITTED IMG, MADE PROVABLE.
//
// final-qa Class A (2026-09, the 8 plumbing builds) shipped pages whose
// photo references broke two ways, both invisible to every asset-level
// gate:
//   · ROOT-ABSOLUTE refs the engine itself stamps — `<img src="/assets/
//     wss-people.webp">`, the lightbox `/assets/wss-stock-1.webp`, the
//     header logo `/assets/client-logo.png` — resolve only on a
//     domain-root deploy. Under the path-based local viewer (and any
//     path-prefixed preview seam) the same bytes the build SHIPS 404,
//     because `/assets/...` leaves the site directory entirely. The team
//     band, lightbox and brand mark rendered as blank holes on every
//     plumbing site (d-s2.png).
//   · ONERROR CHAINS with no compile-time guarantee: a gallery figure
//     whose primary 404s falls back — through `onerror="this.src=…"` —
//     to ANOTHER reference nobody proved ships. Both ends 404 and the
//     reader sees the broken-image icon. The engine's danglingImageRefs
//     scan is report-only and logo-scoped, so nothing failed.
//
// This module owns the fix, in the hero-poster.js pattern:
//
//   1. NORMALIZE — every root-absolute `/assets/...` image reference in
//      HTML attributes (src/href/poster/srcset), inline style url() and
//      linked CSS url() is rewritten to the page-depth-correct RELATIVE
//      form. Relative refs serve unchanged under domain-root, path-prefix
//      and file:// serving; absolute http(s) forms (og:image, JSON-LD) are
//      left alone — they must stay absolute by spec.
//
//   2. THE ASSERTION — after normalization, every image reference on every
//      page (and every onerror fallback target) must resolve to a file in
//      the emitted bundle whose bytes sniff as an image. A dangling ref
//      self-heals to the donor's bundled real photograph before it can
//      ship; a dangling onerror target is re-pointed at the same photo.
//
// Node 20+, CommonJS, zero npm deps. Fail-soft by contract: any internal
// refusal degrades to "leave the tree as it was" with a named reason.

const { sniffImage } = require("./hero-media");

const ASSET_EXT_RE = /\.(?:png|jpe?g|webp|svg|gif|avif)(?:$|[?#])/i;
// An image-looking reference in an HTML attribute: relative (assets/…,
// ../assets/…), root-absolute (/assets/…) — data:, blob:, http(s), mailto,
// tel and # fragments are never rewritten (absolute http forms are
// resolved for the assertion but rewritten by nobody: og:image and
// JSON-LD image must stay absolute).
const REF_ATTR_RE = /\b(src|href|poster|srcset)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const CSS_URL_RE = /url\(\s*(?:'|")?(\/assets\/[^'")\s]+)(?:'|")?\s*\)/gi;
const ONERROR_SRC_RE = /\bonerror\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function isImageRel(rel) {
  return ASSET_EXT_RE.test(String(rel || ""));
}

/** Strip query/hash, absolutize an http(s) URL to its path, drop leading slashes. */
function normalizeRef(raw) {
  let v = String(raw || "").trim();
  if (!v || /^(?:data:|blob:|mailto:|tel:|#)/i.test(v)) return null;
  if (/^https?:\/\//i.test(v)) {
    try { v = new URL(v).pathname; } catch { return null; }
  }
  v = v.split("?")[0].split("#")[0];
  if (!v || !isImageRel(v)) return null;
  return v;
}

/** Resolve a reference against the page's own directory depth. */
function resolveAgainstPage(raw, pageRel) {
  const ref = normalizeRef(raw);
  if (!ref) return null;
  let rel;
  if (ref.startsWith("/")) {
    rel = ref.replace(/^\/+/, "");
  } else {
    const dir = path_posix_dirname(pageRel);
    rel = path_posix_join(dir, ref);
  }
  return rel.replace(/^\.\/+/, "");
}

function path_posix_dirname(p) {
  const i = String(p || "").lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function path_posix_join(dir, ref) {
  const parts = (dir ? dir.split("/") : []);
  for (const seg of String(ref).split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** The depth-correct relative prefix for a page ("a/b/index.html" -> "../../"). */
function relativePrefix(pageRel) {
  const dir = path_posix_dirname(pageRel);
  return dir ? `${dir.split("/").map(() => "..").join("/")}/` : "";
}

/* ------------------------------------------------------------------ *
 * 1. NORMALIZE — root-absolute -> depth-correct relative
 * ------------------------------------------------------------------ */

/**
 * applyRootAbsoluteNormalization({ files })
 *   -> { pages, rewritten, css_files, css_rewrites }
 * Rewrites root-absolute /assets/... image references in HTML attributes,
 * inline style url() and linked CSS url() to relative forms that serve
 * unchanged under domain-root AND path-prefix viewers. Never touches
 * absolute http(s) references (og:image, JSON-LD), data: URIs or refs to
 * paths that do not exist in the bundle (a dangling ref is the
 * assertion's problem, not the normalizer's).
 */
function applyRootAbsoluteNormalization({ files = {} } = {}) {
  const out = { pages: 0, rewritten: 0, css_files: 0, css_rewrites: 0 };
  try {
    for (const rel of Object.keys(files)) {
      if (/\.html$/i.test(rel)) {
        const html = files[rel].toString("utf8");
        const prefix = relativePrefix(rel);
        let next = html;
        // Attributes (skip values that are absolute http(s): og/JSON-LD and
        // origin-mode media must stay absolute).
        next = next.replace(REF_ATTR_RE, (whole, attr, _q, dq, sq) => {
          const value = dq != null ? dq : sq;
          if (!value || /^https?:/i.test(value.trim())) return whole;
          const parts = String(attr).toLowerCase() === "srcset"
            ? value.split(",").map((tok) => tok.trim())
            : [value.trim()];
          let changed = false;
          const mapped = parts.map((tok) => {
            const [url, ...desc] = tok.split(/\s+/);
            if (!url || !url.startsWith("/assets/") || !isImageRel(url)) return tok;
            const target = url.replace(/^\/+/, "");
            if (!(target in files)) return tok;
            changed = true;
            const relUrl = `${prefix}${target}`;
            return [relUrl, ...desc].join(" ");
          });
          if (!changed) return whole;
          out.rewritten += 1;
          const quote = dq != null ? '"' : "'";
          return `${attr}=${quote}${mapped.join(", ")}${quote}`;
        });
        // Inline style url() — same law.
        next = next.replace(CSS_URL_RE, (whole, url) => {
          const target = url.replace(/^\/+/, "");
          if (!(target in files)) return whole;
          out.rewritten += 1;
          return `url('${prefix}${target}')`;
        });
        if (next !== html) {
          files[rel] = Buffer.from(next, "utf8");
          out.pages += 1;
        }
      } else if (/\.css$/i.test(rel)) {
        const css = files[rel].toString("utf8");
        // A CSS file lives at its own depth: assets/x.css referencing
        // /assets/y.webp serves the same bytes from "y.webp".
        const ownPrefix = relativePrefix(rel);
        let next = css;
        next = next.replace(CSS_URL_RE, (whole, url) => {
          const target = url.replace(/^\/+/, "");
          if (!(target in files)) return whole;
          out.css_rewrites += 1;
          return `url('${ownPrefix}${target}')`;
        });
        if (next !== css) {
          files[rel] = Buffer.from(next, "utf8");
          out.css_files += 1;
        }
      }
    }
    return out;
  } catch {
    return { ...out, reason: "photo_ships_normalize_failed" };
  }
}

/* ------------------------------------------------------------------ *
 * 2. THE ASSERTION
 * ------------------------------------------------------------------ */

/**
 * assertPhotosShip({ files, fallbackRel })
 *   -> { ok, refs, resolved, healed, dangling: [{page, rel}], onerror_fixed }
 *
 * Every image reference on every HTML page — src, href (lightbox links),
 * poster, srcset — must resolve to a bundle file whose bytes sniff as an
 * image. So must every onerror fallback target: a chain whose second rung
 * 404s is the Class A defect, not a mitigation. A dangling reference or
 * onerror target self-heals to the fallback rel (the donor's bundled real
 * photograph); `ok` is true only when nothing dangles unhealed.
 */
function assertPhotosShip({ files = {}, fallbackRel = "" } = {}) {
  const out = { ok: false, refs: 0, resolved: 0, healed: 0, dangling: [], onerror_fixed: 0 };
  try {
    const fallbackShips = Boolean(fallbackRel && files[fallbackRel] && sniffImage(files[fallbackRel]));
    // The heal is always the page-depth-correct RELATIVE form of the fallback
    // rel — including for absolute http(s) references: a dangling og:image or
    // JSON-LD image cannot be fixed by keeping a URL that 404s; the relative
    // bundled photograph serves from every origin the page itself serves.
    const healRef = (_raw, pageRel) => `${relativePrefix(pageRel)}${fallbackRel}`;

    for (const pageRel of Object.keys(files)) {
      if (!/\.html$/i.test(pageRel)) continue;
      const html = files[pageRel].toString("utf8");
      let pageHtml = html;
      let mutated = false;

      // (a) onerror fallback targets FIRST — this.src='…' inside an onerror
      // attribute also reads as a src= to pass (b)'s scanner, so the chain
      // gets first claim and its fixes are counted as chain repairs.
      pageHtml = pageHtml.replace(ONERROR_SRC_RE, (whole, dq, sq) => {
        const body = dq != null ? dq : sq;
        if (!body) return whole;
        const inner = body.replace(/this\.onerror\s*=\s*null\s*;?/i, "");
        const m = /this\.src\s*=\s*('([^']*)'|"([^"]*)")/i.exec(inner);
        if (!m) return whole;
        const raw = m[2] != null ? m[2] : m[3];
        const target = resolveAgainstPage(raw, pageRel);
        if (!target) return whole;
        out.refs += 1;
        if (files[target] && sniffImage(files[target])) {
          out.resolved += 1;
          return whole;
        }
        out.dangling.push({ page: pageRel, rel: target, onerror: true });
        if (!fallbackShips) return whole;
        out.healed += 1;
        out.onerror_fixed += 1;
        const healedUrl = healRef(raw, pageRel);
        const quote = m[2] != null ? "'" : '"';
        const prefix = /this\.onerror\s*=\s*null/i.test(body) ? "this.onerror=null;" : "";
        return `onerror="${prefix}this.src=${quote}${healedUrl}${quote}"`;
      });

      // (b) attribute references (the onerror body's this.src= was already
      // verified or healed above; a shipped target re-counts here as the
      // plain reference it also is).
      pageHtml = pageHtml.replace(REF_ATTR_RE, (whole, attr, _q, dq, sq) => {
        const value = dq != null ? dq : sq;
        if (!value) return whole;
        const isSrcset = String(attr).toLowerCase() === "srcset";
        const parts = isSrcset
          ? value.split(",").map((tok) => tok.trim())
          : [value];
        const mapped = parts.map((tok) => {
          const [url, ...desc] = tok.split(/\s+/);
          const target = resolveAgainstPage(url, pageRel);
          if (!target) return tok;
          out.refs += 1;
          if (files[target] && sniffImage(files[target])) {
            out.resolved += 1;
            return tok;
          }
          out.dangling.push({ page: pageRel, rel: target });
          if (!fallbackShips) return tok;
          out.healed += 1;
          const healedUrl = healRef(url, pageRel);
          return healedUrl ? [healedUrl, ...desc].join(" ") : tok;
        });
        const nextValue = mapped.join(isSrcset ? ", " : "");
        if (nextValue !== value) {
          mutated = true;
          const quote = dq != null ? '"' : "'";
          return `${attr}=${quote}${nextValue}${quote}`;
        }
        return whole;
      });

      if (mutated) files[pageRel] = Buffer.from(pageHtml, "utf8");
    }

    out.ok = out.dangling.length === out.healed;
    return out;
  } catch {
    return { ...out, ok: false };
  }
}

/**
 * resolvePhotoFallback({ files, manifest, donorDir }) — the donor's bundled
 * real photograph, the heal target for every dangling reference. Hero
 * manifest poster first (the hero-poster law's own resolution), then the
 * largest shipped raster among the manifest photo_slots, then any shipped
 * donor raster under assets/. Returns { rel, bytes, reason }.
 */
function resolvePhotoFallback({ files = {}, manifest = {}, donorDir = "" } = {}) {
  try {
    const declared = manifest && manifest.hero_video && String(manifest.hero_video.poster || "").trim();
    if (declared && /^[\w./-]+$/.test(declared) && files[declared] && sniffImage(files[declared])) {
      return { rel: declared, bytes: files[declared], reason: "" };
    }
    const slots = Array.isArray(manifest.photo_slots) ? manifest.photo_slots : [];
    const shipped = slots
      .filter((rel) => files[rel] && sniffImage(files[rel]))
      .sort((a, b) => (files[b].length - files[a].length));
    if (shipped.length) return { rel: shipped[0], bytes: files[shipped[0]], reason: "" };
    const anyRaster = Object.keys(files)
      .filter((rel) => /^assets\//i.test(rel) && isImageRel(rel) && !/\.svg$/i.test(rel) && sniffImage(files[rel]))
      .sort((a, b) => files[b].length - files[a].length);
    if (anyRaster.length) return { rel: anyRaster[0], bytes: files[anyRaster[0]], reason: "" };
    return { rel: "", bytes: null, reason: donorDir ? "no_shipped_raster" : "no_donor_dir" };
  } catch (e) {
    return { rel: "", bytes: null, reason: `photo_fallback_failed:${String((e && e.message) || e).slice(0, 60)}` };
  }
}

/**
 * applyPhotoShipsPass({ files, manifest, donorDir })
 *   -> { applied, normalize, assertion, fallback_rel, reason }
 * The full lane: normalize root-absolute refs, resolve the heal target,
 * run the assertion. Mutates `files` in place. Used scoped to the plumbing
 * family at the engine call site (Class A owners); the module itself is
 * donor-agnostic and ready for the fleet-wide rollout once the other
 * families' baseline caches are re-pinned.
 */
function applyPhotoShipsPass({ files = {}, manifest = {}, donorDir = "" } = {}) {
  const state = { applied: false, normalize: null, assertion: null, fallback_rel: "", reason: "" };
  try {
    state.normalize = applyRootAbsoluteNormalization({ files });
    const fallback = resolvePhotoFallback({ files, manifest, donorDir });
    state.fallback_rel = fallback.rel;
    state.reason = fallback.reason;
    if (fallback.rel) {
      state.assertion = assertPhotosShip({ files, fallbackRel: fallback.rel });
      state.applied = true;
    }
    return state;
  } catch (e) {
    state.reason = `photo_ships_pass_failed:${String((e && e.message) || e).slice(0, 80)}`;
    return state;
  }
}

module.exports = {
  applyPhotoShipsPass,
  applyRootAbsoluteNormalization,
  assertPhotosShip,
  resolvePhotoFallback,
  normalizeRef,
  resolveAgainstPage,
  relativePrefix,
};

if (require.main === module && process.argv.includes("--test")) {
  // Smoke: shape 1 — a root-absolute ref whose bytes SHIP normalizes to the
  // relative form; shape 2 — dangling refs and a dangling onerror target
  // heal to the donor's bundled real photograph.
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 0)]);
  const WEBP = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4, 0), Buffer.from("WEBP", "ascii")]);
  const files = {
    "index.html": Buffer.from(
      '<img src="/assets/wss-people.webp" alt="team"><a href="/assets/missing.jpg"><img src="assets/ok.jpg" onerror="this.onerror=null;this.src=\'/assets/gone.webp\'"></a>',
      "utf8",
    ),
    "assets/wss-people.webp": WEBP,
    "assets/ok.jpg": JPG,
    "assets/donor-poster.jpg": JPG,
  };
  const r = applyPhotoShipsPass({
    files,
    manifest: { hero_video: { poster: "assets/donor-poster.jpg" }, photo_slots: ["assets/ok.jpg"] },
  });
  const html = files["index.html"].toString("utf8");
  const pass = r.applied
    && html.includes('src="assets/wss-people.webp"')
    && html.includes('href="assets/donor-poster.jpg"')
    && /onerror="this\.onerror=null;this\.src='assets\/donor-poster\.jpg'"/.test(html)
    && r.assertion.ok
    && r.normalize.rewritten >= 1;
  console.log(`${pass ? "PASS" : "FAIL"} photo-ships smoke`);
  if (!pass) {
    console.log("after:", html, "\nreport:", JSON.stringify(r, null, 1));
    process.exit(1);
  }
}
