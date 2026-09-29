"use strict";

// lib/mirror-engine/donor.js — donor resolution + loading.
//
// A donor is a PRE-COMPILED dist (already-built HTML/JS/CSS/media), never
// source — no framework build runs per customer; that is what makes a mirror
// seconds instead of minutes. Donors live under one configured root:
//
//   donors/<name>/BOILERPLATE.json + index.html + assets/ + media/
//
// Explicit donor names must resolve INSIDE the configured donor root
// (path-confinement — the request field is caller input).

const fs = require("node:fs");
const path = require("node:path");
const { donorContentHash } = require("./build-hash");

// renderAudit receives the donor manifest's content_render_targets but, by
// design, not the donor loader result. Bind only the immutable donor identity
// needed by the empty-baseline cache to that targets object without changing
// its enumerable/JSON shape. The hash itself stays in this module's process-
// local table and is refreshed from the exact bytes loadDonor() returns.
const CONTENT_TARGET_CACHE_IDENTITY = Symbol("wss.mirror.content-target-cache-identity");
const donorContentHashByDir = new Map();

function bindContentTargetCacheIdentity(manifest, dir) {
  const targets = manifest && manifest.content_render_targets;
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) return;
  const resolvedDir = path.resolve(dir);
  try {
    Object.defineProperty(targets, CONTENT_TARGET_CACHE_IDENTITY, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        donorId: path.basename(resolvedDir),
        donorVersion: String(manifest.version || manifest.donor_version || manifest.sanitised || manifest.sanitized || ""),
        donorDir: resolvedDir,
      }),
    });
  } catch {
    // Cache identity is a performance hint only. A frozen/custom manifest must
    // still load and render with the pre-cache fail-closed behavior.
  }
}

function donorBaselineCacheIdentity(contentRenderTargets) {
  if (!contentRenderTargets || typeof contentRenderTargets !== "object") return null;
  const bound = contentRenderTargets[CONTENT_TARGET_CACHE_IDENTITY];
  if (!bound || !bound.donorId || !bound.donorDir) return null;
  const donorHash = donorContentHashByDir.get(bound.donorDir);
  if (!donorHash) return null;
  return {
    donorId: bound.donorId,
    donorVersion: bound.donorVersion,
    donorHash,
  };
}

// Default root: donors-clean — the real, sanitised donor library.
//
// THIS DEFAULT USED TO BE boilerplates/ AND THAT WAS A LIVE PRODUCTION BUG.
// api/mirror.js never sets MIRROR_DONOR_ROOT, so production ran on the default.
// Meanwhile lib/donor-verticals.js — the alias layer that api/mirror.js applies
// to every request — has always defaulted to donors-clean. The two halves of one
// request path disagreed about where donors live, with this result (proven at
// the console, MIRROR_DONOR_ROOT unset):
//
//   applyDonorAlias(industry:"masonry") -> {donor:"concrete-elconstruction"}
//   resolveDonor({donor:"concrete-elconstruction"})
//       -> 404 donor_not_found {reason:"no_built_dist"}
//   resolveDonor({industry:"concrete"}) -> 404 no_donor_for_vertical
//   resolveDonor({industry:"fencing"})  -> 404 no_donor_for_vertical
//
// concrete and fencing are the two verticals the clean library was BUILT for,
// and neither could be mirrored by the API. Every alias (deck, decking, fence,
// masonry, hardscaping, flatwork) resolved to a donor the engine then could not
// find. boilerplates/ is a four-donor scratch folder — two of its four are now
// retired — and it was never the library.
//
// Override with MIRROR_DONOR_ROOT to point at a different library.
function donorRoot() {
  const configured = String(process.env.MIRROR_DONOR_ROOT || "").trim();
  return configured || path.join(__dirname, "..", "..", "donors-clean");
}

/**
 * RETIREMENT. A donor manifest can take itself out of service:
 *
 *   "retired": { "since": "2026-07-31", "reason": "…", "repairable": true }
 *   "retired": true                                   (shorthand)
 *
 * Read AT RESOLUTION, so it blocks BOTH ways a donor gets selected — the
 * vertical match AND an explicit `donor` name on the request. The older
 * `__retired__<vertical>` convention (donors-clean/roofing-falcon-clean) only
 * ever blocked the vertical match; a request naming the donor walked straight
 * past it, which is not "unselectable".
 *
 * NOT read here: `retired_for_outreach`. That flag means "stop mining this
 * category", not "this dist is unsafe to ship" — those donors still build.
 *
 * Returns null (in service) or { reason, since, repairable }.
 */
function donorRetirement(manifest) {
  const r = manifest && manifest.retired;
  if (!r) return null;
  if (typeof r !== "object") return { reason: r === true ? "retired" : String(r), since: "", repairable: true };
  return {
    reason: String(r.reason || "retired"),
    since: String(r.since || ""),
    repairable: r.repairable !== false,
  };
}

function listDonors(root = donorRoot()) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const manifestPath = path.join(root, e.name, "BOILERPLATE.json");
      if (!fs.existsSync(manifestPath)) return null;
      try {
        return { name: e.name, ...JSON.parse(fs.readFileSync(manifestPath, "utf8")) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Resolve a donor by explicit name (path-confined) or by vertical.
 * Returns { ok:true, name, dir, manifest } or { ok:false, error, detail }.
 */
function resolveDonor({ donor, industry }, root = donorRoot()) {
  if (donor) {
    const safe = String(donor).replace(/[^a-z0-9-]/g, "");
    const dir = path.resolve(root, safe);
    if (safe !== String(donor) || !dir.startsWith(path.resolve(root) + path.sep)) {
      return { ok: false, error: "donor_not_found", detail: [{ reason: "donor_name_escapes_root", value: donor }] };
    }
    if (!fs.existsSync(path.join(dir, "index.html"))) {
      return { ok: false, error: "donor_not_found", detail: [{ reason: "no_built_dist", value: donor }] };
    }
    const manifest = readManifest(dir);
    const retired = donorRetirement(manifest);
    if (retired) {
      // A named request is the one path that used to survive retirement. It
      // does not any more: the dist is kept for repair, not for shipping.
      return {
        ok: false,
        error: "donor_retired",
        detail: [{ reason: "donor_retired", value: safe, since: retired.since, why: retired.reason }],
      };
    }
    return { ok: true, name: safe, dir, manifest };
  }

  // Vertical selection: exact canonical match first; no match is a 404 (the
  // adjacency fallback ships with the full library wiring, not v1 core).
  const all = listDonors(root);
  const wanted = String(industry || "").toLowerCase().trim();
  const forVertical = all.filter((d) => String(d.vertical || "").toLowerCase() === wanted);
  const inService = forVertical.filter((d) => !donorRetirement(d));
  const preferred = preferredDonorFor(wanted);
  const match = (preferred ? inService.find((d) => d.name === preferred) : null)
    || inService.slice().sort((a,b) => String(a.name).localeCompare(String(b.name)))[0];
  if (!match) {
    // "Every donor for this vertical is retired" is a different fact from
    // "no donor was ever built for it" — an operator needs to be told which.
    if (forVertical.length) {
      return {
        ok: false,
        error: "donor_retired",
        detail: forVertical.map((d) => {
          const r = donorRetirement(d);
          return { reason: "donor_retired", value: d.name, vertical: wanted, since: r.since, why: r.reason };
        }),
      };
    }
    return { ok: false, error: "donor_not_found", detail: [{ reason: "no_donor_for_vertical", value: wanted }] };
  }
  const dir = path.join(root, match.name);
  return { ok: true, name: match.name, dir, manifest: readManifest(dir) };
}

function preferredDonorFor(vertical) {
  const tablePath = path.join(__dirname, '..', '..', 'data', 'donor-verticals.json');
  try {
    const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    return String((table.canonical || {})[String(vertical || '').toLowerCase()] || '').trim();
  } catch { return ''; }
}

function readManifest(dir) {
  const p = path.join(dir, "BOILERPLATE.json");
  if (!fs.existsSync(p)) return {};
  try {
    const manifest = JSON.parse(fs.readFileSync(p, "utf8"));
    bindContentTargetCacheIdentity(manifest, dir);
    return manifest;
  } catch { return {}; }
}

/** Load every donor file into memory: { relPath -> Buffer }. */
function loadDonorFiles(dir) {
  const files = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      // Sourcemaps never ship: they're donor-source dead weight, and Vercel's
      // production serving 403s .map requests, which fails byteDiff on files
      // nobody needs.
      else if (e.name.endsWith(".map")) continue;
      // ESM donor chunks are stored as .js.raw: Vercel's function builder
      // TRANSPILES any ESM-looking .js it traces into the bundle (proven by
      // donor-probe — /var/task held a CJS 876KB copy of the tattoo donor's
      // 583KB index chunk plus 21 generated sourcemaps, and the deployed
      // mirror died with "exports is not defined"). A .raw suffix makes the
      // builder treat the file as data; the loader restores the real name.
      else if (e.name.endsWith(".js.raw")) {
        files[path.relative(dir, full).split(path.sep).join("/").slice(0, -4)] = fs.readFileSync(full);
      } else files[path.relative(dir, full).split(path.sep).join("/")] = fs.readFileSync(full);
    }
  };
  walk(dir);
  return files;
}

/** Files + content hash in one read, so hash and build see identical bytes. */
function loadDonor(dir) {
  const files = loadDonorFiles(dir);
  const contentHash = donorContentHash(files);
  donorContentHashByDir.set(path.resolve(dir), contentHash);
  return { files, contentHash };
}

module.exports = {
  donorRoot,
  listDonors,
  resolveDonor,
  loadDonor,
  loadDonorFiles,
  donorRetirement,
  preferredDonorFor,
  donorBaselineCacheIdentity,
};
