"use strict";

// lib/mirror-engine/hero-video-paths.js — THE HERO VIDEO PATHS, MADE PROVABLE.
//
// CLASS D (final-qa verdict-matrix 2026-09-04, bradley; latent on the whole
// hvac-premier/fencing fleet): the hero video's emitted references pointed at
// ROOT-ABSOLUTE paths — `/hero/hero-poster.jpg`, `/hero/hero-loop.mp4`,
// `/assets/hero-fallback-fencing.mp4` — while the actual bytes ship at the
// site-RELATIVE copies (`hero/…`, `assets/…`). Under any serving topology
// that mounts a build below a path prefix (the multi-site preview and QA
// server at /<slug>/), every root-absolute reference 404s: the poster
// never paints, every ladder rung errors, and the dead video element
// renders as a blank rectangle occluding the real hero. Three emitters
// conspire, all in donor bytes the engine ships as-is:
//
//   · the ladder walkers' runtime absolutization —
//     `clip.src=src.charAt(0)==="/" ? src : "/"+src;` — turns every island
//     rung root-absolute the moment it arms (ten donors ship this line);
//   · the paint-under CSS (`url("/hero/hero-poster.jpg")` on the
//     hvac-premier family) behind the marked video;
//   · quoted root-absolute literals in the mount bundles and page markup.
//
// This module owns the video end to end, in two moves modeled directly on
// hero-poster.js's poster law:
//
//   1. THE PATH REPAIR (applyHeroVideoPathPass) — every emitted video
//      src/poster reference to a shipped hero asset is rewritten to the
//      DEPTH-CORRECT site-relative form (bare on root pages, `../`-prefixed
//      on nested pages, CSS-dir-relative inside stylesheets), and the
//      walkers' absolutization line is neutralized so the island's own
//      relative rungs are used verbatim at runtime.
//
//   2. THE ASSERTION (assertHeroVideoShips) — a compile-time proof, run
//      after every other pass: every video src/poster reference on every
//      page — poster attributes, <source src>, ladder-island rungs,
//      paint-under url()s, walker/bundle .src and .poster assignments —
//      must resolve to bytes in the emitted bundle (raster magic for
//      posters, mp4/webm magic for clips). A dangling reference self-heals
//      to the donor's own shipped fallback clip / poster before it can
//      ship; an unhealable one is reported so the build cannot claim a
//      clean ladder it did not emit.
//
// The runtime visibility laws are NOT touched here: the video stays hidden
// until a real loaded frame (first-impression's frame-ready guard + the
// ladder failsafe's [hidden]/[data-hero-dead] display:none) and the poster
// photograph is the visible-by-default surface underneath.

const { sniffImage } = require("./hero-media");

const CLIP_EXT_RE = /\.(mp4|webm)(?:[?#]|$)/i;
const IMAGE_EXT_RE = /\.(?:svg|jpe?g|png|webp|avif)(?:[?#]|$)/i;
// The hero media namespaces the fleet ships clips and posters under.
const HERO_CLIP_REL_RE = /^(?:assets|hero|media)\/[^/]*hero[^/]*\.(?:mp4|webm)$/i;
const HERO_POSTER_REL_RE = /^(?:assets|hero|media)\/[^/]*hero[^/]*\.(?:jpe?g|png|webp|avif)$/i;

/* ------------------------------------------------------------------ *
 * Byte sniffing
 * ------------------------------------------------------------------ */

/** A shipped clip must carry mp4 (ftyp-family) or webm (EBML) magic. */
function sniffClip(buf) {
  if (!buf || buf.length < 12) return false;
  const box = buf.slice(4, 8).toString("latin1");
  if (box === "ftyp" || box === "moov" || box === "mdat" || box === "free" || box === "skip" || box === "wide") return true;
  return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

/**
 * A shipped poster must be a real image: raster magic, or the drawn SVG
 * the drawn-placeholder donors ship (an SVG poster paints — the Class D
 * defect is the reference that resolves to NOTHING, never the format).
 */
function imageShips(buf) {
  if (!buf || !buf.length) return false;
  return Boolean(sniffImage(buf)
    || /^\s*(?:<\?xml[^>]*\?>)?\s*<svg/i.test(buf.slice(0, 256).toString("utf8")));
}

/* ------------------------------------------------------------------ *
 * Shipped-asset inventory
 * ------------------------------------------------------------------ */

/**
 * Every hero clip/poster rel that actually ships in this build: the
 * manifest's declared paths, the ladder islands' rungs, and the fleet's
 * hero-named media files. Each returned rel carries verified bytes.
 */
function shippedHeroMedia({ files = {}, manifest = {} } = {}) {
  const declared = manifest && manifest.hero_video && typeof manifest.hero_video === "object"
    ? manifest.hero_video : {};
  const clips = new Set();
  const posters = new Set();
  const addClip = (rel) => {
    const clean = String(rel || "").replace(/^\//, "").split("?")[0].split("#")[0];
    if (clean && files[clean] && sniffClip(files[clean])) clips.add(clean);
  };
  const addPoster = (rel) => {
    const clean = String(rel || "").replace(/^\//, "").split("?")[0].split("#")[0];
    if (clean && files[clean] && imageShips(files[clean])) posters.add(clean);
  };
  addClip(declared.client_video_path);
  addClip(declared.wss_fallback_clip_path || declared.fallback_clip_path);
  addPoster(declared.poster);
  for (const rel of Object.keys(files)) {
    if (HERO_CLIP_REL_RE.test(rel)) addClip(rel);
    if (HERO_POSTER_REL_RE.test(rel)) addPoster(rel);
  }
  for (const rung of ladderSources(files)) addClip(rung);
  return {
    clips,
    posters,
    // Heal targets, most-canonical first: the manifest's own fallback clip
    // and poster photograph (both byte-verified above).
    fallbackClip: (declared.wss_fallback_clip_path || declared.fallback_clip_path || "")
      .replace(/^\//, "") || [...clips][0] || "",
    fallbackPoster: String(declared.poster || "").replace(/^\//, "") || [...posters][0] || "",
  };
}

/** Every ladder island's rungs, parsed out of the emitted tree. */
function ladderSources(files) {
  const rungs = [];
  for (const rel of Object.keys(files)) {
    if (!/\.(?:html?|js)$/i.test(rel)) continue;
    const text = files[rel].toString("utf8");
    const islandRe = /(<script\b[^>]*\bid\s*=\s*(["'])hero-video-ladder\2[^>]*>)([\s\S]*?)(<\/script>)/gi;
    let m;
    while ((m = islandRe.exec(text))) {
      try {
        const parsed = JSON.parse(m[3]);
        if (Array.isArray(parsed.sources)) for (const s of parsed.sources) rungs.push(String(s));
      } catch { /* an unparseable island proves nothing */ }
    }
  }
  return rungs;
}

/* ------------------------------------------------------------------ *
 * Reference resolution
 * ------------------------------------------------------------------ */

/** The page-directory prefix that makes a bare rel resolve from `pageRel`. */
function pagePrefix(pageRel) {
  const depth = String(pageRel || "").split("/").length - 1;
  return depth ? "../".repeat(depth) : "";
}

/** The CSS-directory prefix that makes a bare rel resolve from `cssRel` —
 * the escape path BACK to the site root (a stylesheet at assets/x.css needs
 * `../`, one at the root needs nothing). */
function cssPrefix(cssRel) {
  const depth = path_dir(cssRel).split("/").filter(Boolean).length;
  return depth ? "../".repeat(depth) : "";
}

function path_dir(rel) {
  const parts = String(rel || "").split("/");
  parts.pop();
  return parts.join("/");
}

/** Resolve one emitted reference to the bundle rel it names (or ""). */
function resolveRef(raw, pageRel) {
  let v = String(raw || "").trim();
  if (!v || /^(?:data|blob|mailto|tel):/i.test(v)) return "";
  if (/^https?:\/\//i.test(v)) {
    try { v = new URL(v).pathname; } catch { return ""; }
  }
  v = v.split("?")[0].split("#")[0];
  let rel;
  if (v.startsWith("/")) {
    rel = v.slice(1);
  } else {
    const dir = path_dir(pageRel);
    const stack = dir ? dir.split("/") : [];
    for (const part of v.split("/")) {
      if (part === "..") stack.pop();
      else if (part && part !== ".") stack.push(part);
    }
    rel = stack.join("/");
  }
  return decodeURIComponent(rel || "");
}

/* ------------------------------------------------------------------ *
 * The pass
 * ------------------------------------------------------------------ */

/** The walker absolutization, fleet-wide: `w.src=a.charAt(0)==="/" ? a : "/"+a;` */
const WALKER_ABS_RE = /(\w+)\.src\s*=\s*(\w+)\.charAt\(0\)\s*===\s*["']\/["']\s*\?\s*\2\s*:\s*["']\/["']\s*\+\s*\2\s*;/g;

/**
 * applyHeroVideoPathPass({ files, manifest })
 *   -> { applied, walker_fixes, rewrites, pages, clips, posters,
 *        fallback_clip, fallback_poster }
 * Mutates `files` in place. Every root-absolute reference to a SHIPPED
 * hero clip/poster becomes the depth-correct site-relative form; the
 * walkers' `"/"+src` absolutization is replaced by the island's verbatim
 * rung. Unshipped roots are left for the ships assertion to report.
 */
function applyHeroVideoPathPass({ files = {}, manifest = {} } = {}) {
  const state = {
    applied: false,
    walker_fixes: 0,
    rewrites: 0,
    pages: 0,
    clips: 0,
    posters: 0,
    fallback_clip: "",
    fallback_poster: "",
  };
  try {
    const media = shippedHeroMedia({ files, manifest });
    state.clips = media.clips.size;
    state.posters = media.posters.size;
    state.fallback_clip = media.fallbackClip;
    state.fallback_poster = media.fallbackPoster;

    for (const rel of Object.keys(files)) {
      const isHtml = /\.html?$/i.test(rel);
      const isCss = /\.css$/i.test(rel);
      const isJs = /\.js$/i.test(rel);
      if (!isHtml && !isCss && !isJs) continue;
      const text = files[rel].toString("utf8");
      let next = text;
      let hits = 0;

      // 1. The walkers' runtime absolutization — the island rungs are
      //    site-relative and shipped; use them verbatim. Applied whether or
      //    not this build ships hero media: the absolutization line is a
      //    hazard in every tree that carries it.
      next = next.replace(WALKER_ABS_RE, (whole, target, value) => {
        hits += 1;
        return `${target}.src=${value};`;
      });

      // 2. Root-absolute references to shipped hero media → relative.
      if (media.clips.size || media.posters.size) {
        const prefix = isCss ? cssPrefix(rel) : isJs ? "" : pagePrefix(rel);
        for (const mediaRel of [...media.clips, ...media.posters]) {
          const absNeedle = `/${mediaRel}`;
          // Quoted literal forms (HTML attrs, JS strings, island JSON):
          const quoted = `"${absNeedle}"`;
          const quotedTo = `"${prefix}${mediaRel}"`;
          if (next.includes(quoted)) {
            hits += countOf(next, quoted);
            next = next.split(quoted).join(quotedTo);
          }
          const quotedSingle = `'${absNeedle}'`;
          if (next.includes(quotedSingle)) {
            hits += countOf(next, quotedSingle);
            next = next.split(quotedSingle).join(`'${prefix}${mediaRel}'`);
          }
          // CSS url() forms, quoted and bare:
          if (isCss || isHtml) {
            for (const [from, to] of [
              [`url("${absNeedle}")`, `url("${prefix}${mediaRel}")`],
              [`url('${absNeedle}')`, `url('${prefix}${mediaRel}')`],
              [`url(${absNeedle})`, `url(${prefix}${mediaRel})`],
            ]) {
              if (next.includes(from)) {
                hits += countOf(next, from);
                next = next.split(from).join(to);
              }
            }
          }
        }
      }

      if (next !== text) {
        files[rel] = Buffer.from(next, "utf8");
        state.rewrites += hits;
        if (isHtml) state.pages += 1;
      }
    }

    state.walker_fixes = state.rewrites; // walker lines are counted among rewrites
    state.applied = true;
    return state;
  } catch {
    return { ...state, applied: false };
  }
}

function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/* ------------------------------------------------------------------ *
 * The compile-time assertion
 * ------------------------------------------------------------------ */

/**
 * assertHeroVideoShips({ files, manifest, fallbackClipRel, fallbackPosterRel })
 *   -> { ok, refs, healed, dangling: [{page, rel, kind}], islands_fixed }
 *
 * Every emitted video src/poster reference must resolve to shipped bytes:
 *   · poster attributes on <video> tags and .poster assignments in the
 *     bundles — raster image magic;
 *   · <source src>, video .src assignments, and ladder-island rungs —
 *     mp4/webm magic;
 *   · paint-under url() references to hero clips/posters in inline
 *     <style> and .css files.
 * A dangling poster heals to the shipped poster photograph; a dangling
 * clip heals to the shipped fallback clip (or is dropped from its island —
 * a ladder must not carry a rung whose bytes do not ship). `ok` is true
 * only when nothing dangles unhealed.
 */
function assertHeroVideoShips({
  files = {},
  manifest = {},
  fallbackClipRel = "",
  fallbackPosterRel = "",
} = {}) {
  const out = { ok: false, refs: 0, healed: 0, dangling: [], islands_fixed: 0 };
  try {
    const media = shippedHeroMedia({ files, manifest });
    const clipFallback = (fallbackClipRel && files[fallbackClipRel] && sniffClip(files[fallbackClipRel]))
      ? fallbackClipRel : media.fallbackClip;
    const posterFallback = (fallbackPosterRel && files[fallbackPosterRel] && imageShips(files[fallbackPosterRel]))
      ? fallbackPosterRel : media.fallbackPoster;
    const clipShips = (rel) => Boolean(rel && files[rel] && sniffClip(files[rel]));
    const posterShips = (rel) => Boolean(rel && files[rel] && imageShips(files[rel]));

    for (const pageRel of Object.keys(files)) {
      const isHtml = /\.html?$/i.test(pageRel);
      const isCss = /\.css$/i.test(pageRel);
      const isJs = /\.js$/i.test(pageRel);
      if (!isHtml && !isCss && !isJs) continue;
      const html = files[pageRel].toString("utf8");
      // (rel, kind) pairs; kind decides the byte law and the heal target.
      const refs = [];

      if (isHtml || isJs) {
        const prefix = isJs ? "" : pagePrefix(pageRel);
        for (const m of html.matchAll(/<video\b[^>]*>/gi)) {
          const tag = m[0];
          const poster = /\bposter\s*=\s*(["'])([^"']+)\1/i.exec(tag);
          if (poster) refs.push({ raw: poster[2], kind: "poster", quote: poster[1], in: tag });
          const src = /\bsrc\s*=\s*(["'])([^"']+)\1/i.exec(tag);
          if (src) refs.push({ raw: src[2], kind: "clip", quote: src[1], in: tag });
        }
        for (const m of html.matchAll(/<source\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi)) {
          if (CLIP_EXT_RE.test(m[2])) refs.push({ raw: m[2], kind: "clip", quote: m[1], in: m[0] });
        }
        // Bundles and inline walkers: video .src assignments and poster
        // values, keyed on the shipped basenames so no unrelated string
        // is ever asserted (the hero-poster assertion's slug lesson).
        const shippedBase = (candidate) => [...media.clips].some((r) => r.endsWith(candidate))
          || [...media.posters].some((r) => r.endsWith(candidate));
        for (const m of html.matchAll(/\.src\s*=\s*(["'])([^"']+)\1/g)) {
          if (CLIP_EXT_RE.test(m[2]) && shippedBase(baseOf(m[2]))) refs.push({ raw: m[2], kind: "clip", quote: m[1], in: m[0] });
        }
        for (const m of html.matchAll(/\bposter\s*:\s*(["'])([^"']+)\1/g)) {
          if (IMAGE_EXT_RE.test(m[2]) && shippedBase(baseOf(m[2]))) refs.push({ raw: m[2], kind: "poster", quote: m[1], in: m[0] });
        }
        // (Ladder-island rungs are asserted and healed solely by
        // fixIslands below — one owner, one count.)
      }
      if (isHtml || isCss) {
        // Paint-under / preload CSS surfaces.
        for (const m of html.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
          const target = m[2];
          if (CLIP_EXT_RE.test(target) && baseNameHasHero(target)) refs.push({ raw: target, kind: "clip", quote: m[1], in: m[0], css: true });
          else if (IMAGE_EXT_RE.test(target) && baseNameHasHero(target) && baseInShipped(target, media)) refs.push({ raw: target, kind: "poster", quote: m[1], in: m[0], css: true });
        }
      }
      if (!refs.length) continue;

      let pageText = html;
      let mutated = false;
      const seen = new Set();
      for (const ref of refs) {
        const key = `${ref.kind}:${ref.raw}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rel = resolveRef(ref.raw, pageRel);
        if (!rel) continue;
        out.refs += 1;
        const ships = ref.kind === "poster" ? posterShips(rel) : clipShips(rel);
        if (ships) continue;
        const healRel = ref.kind === "poster" ? posterFallback : clipFallback;
        const heals = healRel && (ref.kind === "poster" ? posterShips(healRel) : clipShips(healRel));
        if (!heals) {
          out.dangling.push({ page: pageRel, rel, kind: ref.kind });
          continue;
        }
        // Rewrite the reference to the page/css-relative healed path.
        const prefix = ref.css ? cssPrefix(pageRel) : isJs ? "" : pagePrefix(pageRel);
        const healedRaw = `${prefix}${healRel}`;
        let next;
        if (ref.css) {
          next = pageText.split(ref.in).join(ref.in.replace(ref.raw, healedRaw));
        } else if (ref.island) {
          next = pageText; // island rungs handled below
        } else {
          next = pageText.split(ref.raw).join(healedRaw);
        }
        if (next !== pageText) {
          pageText = next;
          mutated = true;
          out.healed += 1;
        }
      }

      // Island rungs: every rung must ship (a ladder may not arm a 404);
      // unshippable rungs drop, a fully-empty island heals to the shipped
      // fallback clip, root-absolute rungs normalize to the page-relative
      // form so they resolve under any serving prefix.
      if (isHtml && /hero-video-ladder/.test(pageText)) {
        const fixed = fixIslands({ text: pageText, clipShips, clipFallback, prefix: pagePrefix(pageRel), page: pageRel });
        out.refs += fixed.refs;
        out.healed += fixed.healed;
        out.dangling.push(...fixed.dangling);
        if (fixed.text !== pageText) {
          pageText = fixed.text;
          mutated = true;
          out.islands_fixed += fixed.count;
        }
      }

      if (mutated) files[pageRel] = Buffer.from(pageText, "utf8");
    }
    out.ok = out.dangling.length === 0;
    return out;
  } catch {
    return { ...out, ok: false };
  }
}

function baseOf(raw) {
  return String(raw || "").split("?")[0].split("#")[0].split("/").pop().toLowerCase();
}

function baseNameHasHero(raw) {
  return /hero/i.test(baseOf(raw));
}

function baseInShipped(target, media) {
  const base = baseOf(target);
  return [...media.posters].some((r) => r.toLowerCase().endsWith(base))
    || [...media.clips].some((r) => r.toLowerCase().endsWith(base));
}

/**
 * Assert and heal every ladder island on one page. A rung whose bytes do
 * not ship is dropped; a rung that ships but is root-absolute is
 * normalized to the page-relative prefix form; an island left with no
 * shipping rung heals to the shipped fallback clip (never a 404 rung).
 */
function fixIslands({ text, clipShips, clipFallback, prefix, page }) {
  const out = { text, count: 0, refs: 0, healed: 0, dangling: [] };
  const islandRe = /(<script\b[^>]*\bid\s*=\s*(["'])hero-video-ladder\2[^>]*>)([\s\S]*?)(<\/script>)/gi;
  out.text = text.replace(islandRe, (whole, open, quote, json, close) => {
    let parsed = {};
    try { parsed = JSON.parse(json); } catch { return whole; }
    if (!Array.isArray(parsed.sources)) return whole;
    const prefixStrip = (r) => String(r).replace(/^\//, "");
    const normalized = [];
    let changed = false;
    for (const rung of parsed.sources) {
      out.refs += 1;
      const rel = resolveRef(String(rung), page || "index.html");
      if (clipShips(rel)) {
        // Absolute http(s) rungs are other-host by construction: leave them.
        if (/^https?:\/\//i.test(String(rung))) { normalized.push(String(rung)); continue; }
        const target = `${prefix}${prefixStrip(rel)}`;
        if (target !== String(rung)) { changed = true; out.healed += 1; }
        normalized.push(target);
      } else if (clipFallback && clipShips(clipFallback)) {
        changed = true;
        out.healed += 1;
        normalized.push(`${prefix}${prefixStrip(clipFallback)}`);
      } else {
        changed = true;
        out.dangling.push({ page, rel, kind: "clip" });
      }
    }
    if (!changed) return whole;
    out.count += 1;
    return `${open}${JSON.stringify({ ...parsed, sources: normalized })}${close}`;
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Self-test
 * ------------------------------------------------------------------ */

function runTests() {
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  // sniffClip
  {
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(16)]);
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.alloc(12)]);
    const junk = Buffer.from("this is not a video at all........");
    check("sniffClip mp4", sniffClip(mp4));
    check("sniffClip webm", sniffClip(webm));
    check("sniffClip junk", !sniffClip(junk));
  }

  // resolveRef
  {
    check("resolveRef root-absolute", resolveRef("/hero/hero-loop.mp4", "index.html") === "hero/hero-loop.mp4");
    check("resolveRef bare root page", resolveRef("hero/hero-loop.mp4", "index.html") === "hero/hero-loop.mp4");
    check("resolveRef bare nested page", resolveRef("../hero/hero-loop.mp4", "guides/x.html") === "hero/hero-loop.mp4");
    check("resolveRef absolute url", resolveRef("https://x.com/hero/hero-loop.mp4?v=2", "index.html") === "hero/hero-loop.mp4");
    check("resolveRef data url refused", resolveRef("data:video/mp4;base64,AAAA", "index.html") === "");
  }

  // pagePrefix
  {
    check("pagePrefix root", pagePrefix("index.html") === "");
    check("pagePrefix nested", pagePrefix("guides/deck/x.html") === "../../");
  }

  // The walker absolutization dies.
  {
    const donorLine = "clip.src=src.charAt(0)===\"/\" ? src : \"/\"+src;";
    const files = { "index.html": Buffer.from(`<script>${donorLine}</script>`) };
    const state = applyHeroVideoPathPass({
      files,
      manifest: { hero_video: { wss_fallback_clip_path: "hero/hero-loop.mp4", poster: "hero/hero-poster.jpg" } },
    });
    const out = files["index.html"].toString("utf8");
    check("walker absolutization removed", out.includes("clip.src=src;") && !out.includes('"/"+src'), out);
    check("walker fix counted", state.applied && state.rewrites >= 1, JSON.stringify(state));
  }

  process.exit(failures === 0 ? 0 : 1);
}

module.exports = {
  sniffClip,
  shippedHeroMedia,
  ladderSources,
  resolveRef,
  pagePrefix,
  cssPrefix,
  applyHeroVideoPathPass,
  assertHeroVideoShips,
};

if (require.main === module && process.argv.includes("--test")) {
  runTests();
}
