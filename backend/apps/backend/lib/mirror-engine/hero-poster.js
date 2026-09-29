"use strict";

// lib/mirror-engine/hero-poster.js — THE HERO POSTER, MADE PROVABLE.
//
// AUDIT A1 (2026-09-03/04, the 10 hvac builds of line_mtn6z9sl) found the
// hero's first-second surface in three states, all wrong:
//   · the emitted `<img src="assets/hero-poster.<ext>">` whose EXTENSION
//     depends on which photograph happened to be first in the pool (the
//     serverless fallback of commit 328f8440 rewrites the svg slot to the
//     photo's real extension), with NOTHING in the build asserting the
//     reference resolves to bytes that actually ship — any downstream miss
//     paints a broken-image icon, permanently on mobile where the video
//     ladder never arms below 1024px;
//   · builds with no usable photographs keep the donor's 1.5KB drawn SVG
//     placeholder as the hero tile — a graphic, not a photograph;
//   · builds WITH photographs get pool[0] whatever it is: a Colorado
//     service-area map on a Spring TX site, a route diagram on a Michigan
//     one — the type/region gates lib/mirror-engine/media-provenance.js
//     was written to enforce, wired nowhere.
//
// This module owns the poster end to end, in three moves:
//
//   1. SELECTION (selectHeroPosterPhoto) — the client's own photographs,
//      classified through media-provenance (map/logo/stock/unclassified
//      media cannot become the hero poster), region-tagged from their URL
//      evidence (a photograph that names another state is not this hero's),
//      ranked: their flagged current hero > an identity portrait > a
//      region-matching work photograph > any hero-eligible photograph.
//
//   2. EMISSION (applyHeroPosterPass) — the chosen bytes land at
//      `assets/hero-poster.<real ext>` with EVERY reference form rewritten
//      to that one path (bare, root-relative, the absolute og:image/JSON-LD
//      forms ride the bare needle), an onerror attribute that falls back to
//      the donor's OWN real poster photograph (bundled, magic-byte verified
//      at build time — never a broken icon), and — when nothing qualifies —
//      the references point straight at that donor photograph so the tile
//      is a real, climate-neutral trade photo instead of a drawn
//      placeholder. The pass only fires on donors whose manifest ships a
//      REAL raster poster (hero_video.poster sniffed image/*); donors whose
//      declared poster is the drawn svg itself are left untouched.
//
//   3. THE ASSERTION (assertHeroPosterShips) — a compile-time proof, run
//      after every other pass: every hero-poster reference on every page
//      must resolve to a file in the emitted bundle with image magic
//      bytes. A miss self-heals to the donor poster before it can ship.
//
// Node 20+, CommonJS, zero npm deps. Fail-soft by contract: any internal
// refusal degrades to "leave the tree as it was" with a named reason.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  bindProvenance,
  verifyAssetPlacement,
} = require("./media-provenance");
const { sniffImage } = require("./hero-media");
const { STATE_CODES, STATE_NAMES } = require("./place-names");

/* ------------------------------------------------------------------ *
 * Region evidence
 * ------------------------------------------------------------------ */

// state name -> USPS code (STATE_NAMES is code -> name; invert once).
const STATE_CODE_BY_NAME = new Map(
  [...STATE_NAMES.entries()].map(([code, name]) => [String(name).toLowerCase(), code]),
);

/** The build's region key: USPS state code (upper), state name, city. */
function buildRegion({ state = "", city = "" } = {}) {
  const rawState = String(state || "").trim();
  const upper = rawState.toUpperCase();
  const code = STATE_CODES.has(upper)
    ? upper
    : (STATE_CODE_BY_NAME.get(rawState.toLowerCase()) || "");
  const stateName = code ? String(STATE_NAMES.get(code) || "") : "";
  return { code, stateName, city: String(city || "").trim() };
}

/**
 * Region tags for one photograph, from its URL evidence only (the bank rows
 * carry no alt text). The URL's path and query — never the host, the same
 * law media-provenance's classifier follows (CDN hostnames lie about
 * content) — can name states. A photograph naming the build's own state
 * (or city) is `match`; naming any OTHER state is `mismatch`; silence is
 * `unknown` and never a refusal on its own: their own GBP photograph with
 * an opaque token URL is still their own region by ownership.
 */
function photoRegionTag(url, region) {
  if (!region.code) return "unknown";
  let text = "";
  try {
    const u = new URL(String(url || ""));
    text = `${u.pathname}${u.search}`;
  } catch {
    text = String(url || "");
  }
  try { text = decodeURIComponent(text); } catch { /* keep literal */ }
  text = text.toLowerCase();
  if (!text) return "unknown";

  const city = region.city.toLowerCase();
  if (city.length > 3 && new RegExp(`(^|[^a-z])${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text)) {
    return "match";
  }
  if (region.stateName && text.includes(region.stateName.toLowerCase())) return "match";
  if (new RegExp(`(^|[^a-z])${region.code.toLowerCase()}([^a-z]|$)`).test(text)) return "match";

  for (const [name, code] of STATE_CODE_BY_NAME) {
    if (text.includes(name)) return code === region.code ? "match" : "mismatch";
  }
  for (const code of STATE_CODES) {
    const c = code.toLowerCase();
    if (new RegExp(`(^|[^a-z])${c}([^a-z]|$)`).test(text)) {
      return c === region.code.toLowerCase() ? "match" : "mismatch";
    }
  }
  return "unknown";
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

/**
 * The hero-poster photograph, chosen under the media-provenance gates.
 *
 * Hard gates (a refusal, never a substitution):
 *   · verifyAssetPlacement(section:"hero") — the ownership/hash/stock/map/
 *     logo/trade gates media-provenance was built to enforce;
 *   · the record's section_eligibility must actually include "hero" — an
 *     owned-but-unclassified picture (the fleet's opaque GBP bulk) is
 *     gallery/about media, not the hero (media-provenance's own law);
 *   · region mismatch — the photograph's URL names a different state than
 *     the build's (the Colorado-map-on-Texas audit case).
 *
 * Ranking among survivors: current_hero(40) > identity_critical(30) >
 * region-tagged work photograph(25) > any hero-eligible photograph(15),
 * area as the tie-break.
 *
 * @returns {{ photo: object|null, choice: string, reason: string,
 *             ranked: Array, rejected: Array, region: object }}
 */
function selectHeroPosterPhoto({
  usablePhotos = [],
  bank = null,
  facts = {},
  vertical = "",
  prospectId = "",
  heroWashPhoto = null,
} = {}) {
  const region = buildRegion(facts);
  // A direct module call without a prospect scope still needs a non-empty
  // binding for verifyAssetPlacement; the engine always passes the real
  // buildProspectId, and "local" is the honest sentinel for local use.
  const scope = String(prospectId || "").trim() || "local";
  const rows = Array.isArray(bank && bank.photos) ? bank.photos : [];
  const bankRowOf = (photo) =>
    rows.find((r) => r && String(r.url || "") === String(photo.url || "")) || {};

  const ranked = [];
  const rejected = [];
  const list = Array.isArray(usablePhotos) ? usablePhotos : [];
  // The photograph the engine's hero wash actually painted is the hero by
  // the engine's own verdict: it enters selection as the forced rank-40
  // candidate and is exempt from the eligibility/region refusals below
  // (those gates choose among ALTERNATIVES; they may not overrule the
  // wash decision — A1 regression: the untagged client photograph was
  // region-refused and a 1280x720 stock poster took the tile).
  const washUrl = heroWashPhoto && heroWashPhoto.url
    ? String(heroWashPhoto.url)
    : "";

  for (const photo of list) {
    if (!photo || typeof photo !== "object" || !photo.url) continue;
    const row = bankRowOf(photo);
    const isWashPhoto = washUrl && String(photo.url) === washUrl;
    const flags = {
      currentHero: row.current_hero === true || isWashPhoto,
      identityCritical: row.identity_critical === true,
      stockSuspect: row.stock_caption_suspect === true && !isWashPhoto,
    };
    const provenance = bindProvenance(photo, {
      prospectId: scope,
      sourceUrl: photo.url,
      contentHash: photo.sha256,
      url: photo.url,
      context: String(photo.source || ""),
      vertical,
      ...flags,
    });
    const gated = { ...photo, provenance };
    const verified = verifyAssetPlacement(gated, { prospectId: scope, section: "hero" });
    if (!verified.ok) {
      rejected.push({ url: photo.url, reason: verified.reason });
      continue;
    }
    let tag = photoRegionTag(photo.url, region);
    if (tag === "mismatch") {
      rejected.push({ url: photo.url, reason: "region_mismatch" });
      continue;
    }
    // REGION EVIDENCE WIDENS ELIGIBILITY — and the wash photograph (the
    // engine's own painted hero) is exempt from the eligibility refusal
    // only: it is a real, owned, verified photograph whose classification
    // the fleet's opaque GBP bulk simply lacks. A region MISMATCH or a
    // verifyAssetPlacement refusal (map/stock/logo/wrong-trade) binds it
    // like any other candidate — the Colorado-map-on-Texas defect.
    const heroEligible = (Array.isArray(provenance.section_eligibility)
      && provenance.section_eligibility.includes("hero")) || tag === "match" || isWashPhoto;
    if (!heroEligible) {
      rejected.push({ url: photo.url, reason: `ineligible_for_hero:${provenance.media_class}` });
      continue;
    }
    let score = 15;
    if (tag === "match") score = 25;
    if (flags.identityCritical) score = 30;
    if (flags.currentHero || isWashPhoto) score = 40;
    ranked.push({
      url: photo.url,
      sha256: photo.sha256 || "",
      media_class: provenance.media_class,
      region_tag: tag,
      score,
      _photo: gated,
    });
  }

  ranked.sort((a, b) =>
    (b.score - a.score)
    || ((b._photo.width || 0) * (b._photo.height || 0) - (a._photo.width || 0) * (a._photo.height || 0)),
  );

  const winner = ranked[0] || null;
  return {
    photo: winner ? winner._photo : null,
    choice: winner ? (winner.score >= 40 ? "client_current_hero"
      : winner.score >= 30 ? "client_identity_portrait"
        : winner.score >= 25 ? "client_region_tagged_photo"
          : "client_hero_eligible_photo") : "",
    reason: winner ? "" : (list.length ? "no_hero_eligible_region_matched_photo" : "no_usable_photos"),
    ranked: ranked.map(({ _photo, ...rest }) => rest),
    rejected,
    region,
  };
}

/* ------------------------------------------------------------------ *
 * Emission helpers
 * ------------------------------------------------------------------ */

const HERO_POSTER_REL_RE = /^assets\/hero-poster(?:-[A-Za-z0-9_]+)?\.(?:svg|jpe?g|png|webp|avif)$/i;

/** Every emitted rel that is a hero-poster-shaped asset. */
function heroPosterRels(files) {
  return Object.keys(files || {}).filter((rel) => HERO_POSTER_REL_RE.test(rel));
}

/**
 * True when any emitted text file still REFERENCES a hero-poster-shaped
 * asset (bare, root-relative, or domain-absolute form — the bare needle is
 * a substring of the absolute one). Donors wired to the pass before their
 * manifest carried a hero-poster photo_slot entry (the plumbing family's
 * Class A builds, final-qa 2026-09) enter the pass on this evidence too:
 * the manifest's real hero_video.poster is the fallback either way, so the
 * drawn-svg-poster donors still refuse at resolveDonorPoster unchanged.
 */
function heroPosterReferenced(files) {
  for (const rel of Object.keys(files || {})) {
    if (!/\.(html|js|css|json|webmanifest)$/i.test(rel)) continue;
    if (/assets\/hero-poster(?:-[A-Za-z0-9_]+)?\.(?:svg|jpe?g|png|webp|avif)/i.test(files[rel].toString("utf8"))) return true;
  }
  return false;
}

/**
 * The reference rewrite — the engine's own rewriteSlotPath semantics
 * (absolute form first, then the bare form, because the bare needle is a
 * substring of the absolute one), applied across every html/js/css file.
 * Domain-absolute references (`https://host/assets/hero-poster.svg`) ride
 * the bare needle and stay absolute on the other side.
 */
function rewriteRefs(files, fromRel, toRel) {
  const abs = `/${fromRel}`;
  const bare = String(fromRel);
  const absTo = `/${toRel}`;
  const bareTo = String(toRel);
  let rewrites = 0;
  for (const rel of Object.keys(files)) {
    if (!/\.(html|js|css|json|webmanifest)$/i.test(rel)) continue;
    const text = files[rel].toString("utf8");
    if (!text.includes(abs) && !text.includes(bare)) continue;
    let next = text;
    const absHits = next.split(abs).length - 1;
    if (absHits) next = next.split(abs).join(absTo);
    const bareHits = next.split(bare).length - 1;
    if (bareHits) next = next.split(bare).join(bareTo);
    if (next !== text) {
      files[rel] = Buffer.from(next, "utf8");
      rewrites += absHits + bareHits;
    }
  }
  return rewrites;
}

/**
 * The donor's own real poster photograph — the neutral trade fallback and
 * the onerror target. Must (a) exist in the emitted files or on the donor
 * disk, and (b) carry raster image magic bytes (jpg/png/webp/avif). A
 * donor whose declared poster is the drawn svg (fencing-sterling,
 * medspa-luma, professional-services-estimator) has no real-photo fallback
 * and the pass skips it untouched.
 */
function resolveDonorPoster({ files, manifest, donorDir = "" } = {}) {
  const rel = manifest && manifest.hero_video && String(manifest.hero_video.poster || "").trim();
  if (!rel || !/^[\w./-]+$/.test(rel)) return { rel: "", reason: "no_hero_video_poster" };
  const fromFiles = files && files[rel];
  if (fromFiles && sniffImage(fromFiles)) return { rel, bytes: fromFiles, reason: "" };
  if (donorDir) {
    try {
      const abs = path.join(donorDir, rel.split("/"));
      const bytes = fs.readFileSync(abs);
      if (sniffImage(bytes)) return { rel, bytes, reason: "" };
    } catch { /* not on disk either */ }
  }
  return { rel: "", reason: "donor_poster_not_a_real_photo" };
}

/**
 * onerror on the hero poster <img> tags: any runtime miss falls back to
 * the donor's bundled real photograph, never a broken-image icon.
 * A tag is a poster tile when its src basename IS a hero-poster asset,
 * the chosen poster's basename, or the fallback's own basename — the
 * falcon family's donor poster is `assets/hero-roof-bundled-*.jpg`, so
 * keying on the literal string "hero-poster" would miss it.
 * Idempotent — a tag that already carries an onerror is left alone.
 */
function injectPosterOnerror(files, fallbackRel, alsoRel = "") {
  let pages = 0;
  let tags = 0;
  const names = new Set(
    [fallbackRel, alsoRel]
      .filter(Boolean)
      .map((rel) => String(rel).split("/").pop().toLowerCase()),
  );
  if (!names.size) return { pages, tags };
  const isPosterTag = (tag) => {
    const m = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag);
    if (!m) return false;
    const base = String(m[1]).split("?")[0].split("#")[0].split("/").pop().toLowerCase();
    return names.has(base) || /^hero-poster(?:-[a-za-z0-9_]+)?\.(?:svg|jpe?g|png|webp|avif)$/i.test(base);
  };
  for (const rel of Object.keys(files)) {
    if (!/\.html$/i.test(rel)) continue;
    const html = files[rel].toString("utf8");
    if (!/<img\b/i.test(html)) continue;
    let next = html.replace(/<img\b[^>]*>/gi, (tag) => {
      if (!isPosterTag(tag)) return tag;
      if (/\bonerror\s*=/i.test(tag)) return tag;
      tags += 1;
      const safe = fallbackRel.replace(/"/g, "&quot;");
      return tag.replace(/<img\b/i, `<img data-wss-poster-guard onerror="this.onerror=null;this.src='${safe}'"`);
    });
    if (next !== html) {
      files[rel] = Buffer.from(next, "utf8");
      pages += 1;
    }
  }
  return { pages, tags };
}

/* ------------------------------------------------------------------ *
 * The pass
 * ------------------------------------------------------------------ */

/**
 * applyHeroPosterPass({ files, manifest, donorDir, facts, vertical,
 *                        usablePhotos, bank, prospectId, originMode })
 *   -> { applied, choice, poster_rel, poster_sha, poster_ext,
 *        fallback_rel, onerror, rewrites, reason, selection, region,
 *        assertion } — mutates `files` in place.
 *
 * originMode holds no photograph bytes: the pass then only re-points the
 * drawn-placeholder slot at the donor's real poster (our own shipped
 * bytes), records the selection for the migration, and still injects the
 * onerror guard + runs the assertion.
 */
function applyHeroPosterPass({
  heroWashPhoto = null,
  files = {},
  manifest = {},
  donorDir = "",
  facts = {},
  vertical = "",
  usablePhotos = [],
  bank = null,
  prospectId = "",
  originMode = false,
} = {}) {
  const state = {
    applied: false,
    choice: "skipped",
    poster_rel: "",
    poster_sha: "",
    poster_ext: "",
    fallback_rel: "",
    onerror: { pages: 0, tags: 0 },
    rewrites: 0,
    reason: "",
    selection: null,
    region: buildRegion(facts),
  };
  try {
    const slots = (Array.isArray(manifest.photo_slots) ? manifest.photo_slots : [])
      .filter((s) => /hero[-_]poster/i.test(String(s || "")));
    const fallback = resolveDonorPoster({ files, manifest, donorDir });
    // THE GATE: a manifest slot OR a live hero-poster reference in the tree
    // brings a donor under the pass (see heroPosterReferenced). Donors with
    // neither have nothing for the pass to own.
    if (!slots.length && !heroPosterReferenced(files)) { state.reason = "no_hero_poster_slot"; return state; }
    if (!fallback.rel) { state.reason = fallback.reason; return state; }
    state.fallback_rel = fallback.rel;

    // The fallback must be IN the emitted tree even when it came off the
    // donor disk (a slot-fill overwrite can have consumed it).
    if (!files[fallback.rel]) files[fallback.rel] = fallback.bytes;

    const selection = selectHeroPosterPhoto({ usablePhotos, bank, facts, vertical, prospectId, heroWashPhoto });
    state.selection = {
      choice: selection.choice,
      reason: selection.reason,
      region: selection.region,
      ranked: selection.ranked.slice(0, 6),
      rejected: selection.rejected.slice(0, 8),
    };

    let targetRel = "";
    let targetBytes = null;

    if (selection.photo && !originMode && selection.photo.bytes) {
      // A provenance-cleared, region-acceptable photograph ships under its
      // REAL extension at the canonical stem (Vercel serves content-type by
      // extension; true bytes under a true extension mislabel nothing).
      const ext = String(selection.photo.ext || "").toLowerCase().replace("jpeg", "jpg") || "jpg";
      targetRel = `assets/hero-poster.${ext}`;
      targetBytes = selection.photo.bytes;
      state.choice = selection.choice;
      state.poster_sha = selection.photo.sha256
        || createHash("sha256").update(targetBytes).digest("hex");
      state.poster_ext = ext;
    } else {
      // NEUTRAL TRADE FALLBACK: the donor's own real poster photograph.
      // Better a climate-neutral rooftop AC unit than somebody's map, a
      // route diagram, or a drawn placeholder.
      targetRel = fallback.rel;
      targetBytes = files[fallback.rel];
      state.choice = originMode && selection.photo ? "origin_mode_donor_poster"
        : "donor_real_photo_fallback";
      state.reason = selection.reason || (originMode ? "origin_mode" : "");
      state.poster_sha = createHash("sha256").update(targetBytes).digest("hex");
      state.poster_ext = String(targetRel.split(".").pop() || "").toLowerCase();
    }

    // Rewrite EVERY current poster reference to the one target: the
    // manifest's own slots (the svg placeholder, the jpg-slot donors' hashed
    // file) AND any slot-fill extension-fallback rel the earlier placement
    // pass wrote (assets/hero-poster.webp|png|jpg). All of them are
    // assets/hero-poster* by construction; nothing else matches.
    const rewriteSources = new Set([...slots, ...heroPosterRels(files)]);
    for (const rel of rewriteSources) {
      if (rel === targetRel) continue;
      state.rewrites += rewriteRefs(files, rel, targetRel);
    }
    // The bytes land at the target. The donor's own slot file stays in the
    // tree as the documented fallback for any reference form the rewrites
    // might have missed — the engine's own slot-fill law.
    files[targetRel] = targetBytes;
    state.poster_rel = targetRel;
    state.applied = true;

    state.onerror = injectPosterOnerror(files, fallback.rel, targetRel);
    state.assertion = assertHeroPosterShips({ files, fallbackRel: fallback.rel });
    return state;
  } catch (e) {
    state.reason = `hero_poster_pass_failed:${String((e && e.message) || e).slice(0, 80)}`;
    return state;
  }
}

/* ------------------------------------------------------------------ *
 * The compile-time assertion
 * ------------------------------------------------------------------ */

/**
 * assertHeroPosterShips({ files, fallbackRel })
 *
 * Every hero-poster reference on every HTML page — <img src>, preload
 * href, og:image content, poster= attribute, or a bare string in JSON-LD —
 * must resolve to a file in the emitted bundle whose bytes sniff as an
 * image. A dangling or non-image reference self-heals to the fallback
 * rel; healing is counted; `ok` is true only when nothing dangles after.
 */
function assertHeroPosterShips({ files = {}, fallbackRel = "" } = {}) {
  const out = { ok: false, refs: 0, healed: 0, dangling: [], checked: [] };
  try {
    const imageLike = (buf) => Boolean(buf && (sniffImage(buf)
      || /^\s*(?:<\?xml[^>]*\?>)?\s*<svg/i.test(buf.slice(0, 256).toString("utf8"))));
    const absolutized = (value) => {
      const v = String(value || "");
      if (!/^https?:\/\//i.test(v)) return v;
      try { return new URL(v).pathname.replace(/^\//, ""); } catch { return v; }
    };
    // COUNTED = a reference whose own path basename IS a hero-poster asset.
    // A string that merely CONTAINS "hero-poster" — a slug, a preview host,
    // a JSON host field — is somebody else's token (live lesson: a test
    // slug of "wss-test-hero-poster-…" made every absolute URL on the page
    // read as a poster reference) and is never asserted, never healed.
    const isPosterAssetRel = (rel) =>
      /^hero-poster(?:-[A-Za-z0-9_]+)?\.(?:svg|jpe?g|png|webp|avif)$/i
        .test(String(rel || "").split("/").pop() || "");
    const resolves = (raw) => {
      const rel = absolutized(raw).replace(/^\//, "").split("?")[0].split("#")[0];
      if (!rel || !isPosterAssetRel(rel)) return null;
      return { rel, raw, ships: Boolean(files[rel] && imageLike(files[rel])) };
    };

    for (const pageRel of Object.keys(files)) {
      if (!/\.html$/i.test(pageRel)) continue;
      const html = files[pageRel].toString("utf8");
      // Dedup: attribute hits and quoted-string hits name the same values.
      const raws = new Set();
      for (const m of html.matchAll(/(?:src|href|poster|content)\s*=\s*"([^"]*hero-poster[^"]*)"/gi)) raws.add(m[1]);
      for (const m of html.matchAll(/"([^"']*hero-poster[^"']*)"/g)) raws.add(m[1]);
      if (!raws.size) continue;

      let pageHtml = html;
      let mutated = false;
      for (const raw of raws) {
        const verdict = resolves(raw);
        if (!verdict) continue;
        out.refs += 1;
        if (verdict.ships) {
          out.checked.push({ page: pageRel, rel: verdict.rel });
          continue;
        }
        out.dangling.push({ page: pageRel, rel: verdict.rel });
        if (fallbackRel && files[fallbackRel] && imageLike(files[fallbackRel])) {
          let healedRef = `/${fallbackRel}`;
          if (/^https?:\/\//i.test(raw)) {
            try { const u = new URL(raw); u.pathname = `/${fallbackRel}`; healedRef = u.href; } catch { /* keep the bare form */ }
          }
          const next = pageHtml.split(raw).join(healedRef);
          if (next !== pageHtml) {
            pageHtml = next;
            mutated = true;
            out.healed += 1;
          }
        }
      }
      if (mutated) files[pageRel] = Buffer.from(pageHtml, "utf8");
    }
    out.ok = out.dangling.length > 0 ? out.dangling.length === out.healed : true;
    return out;
  } catch {
    return { ...out, ok: false };
  }
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

  // buildRegion
  {
    const r = buildRegion({ state: "MI", city: "Grand Rapids" });
    check("buildRegion codes MI", r.code === "MI" && r.stateName === "michigan" && r.city === "Grand Rapids", JSON.stringify(r));
    const byName = buildRegion({ state: "michigan" });
    check("buildRegion names michigan -> MI", byName.code === "MI", JSON.stringify(byName));
    const none = buildRegion({});
    check("buildRegion empty -> unknown", none.code === "" && none.city === "");
  }

  // photoRegionTag
  {
    const region = buildRegion({ state: "TX", city: "Spring" });
    check("photoRegionTag same state = match", photoRegionTag("https://x.com/photos/texas-rooftop.jpg", region) === "match");
    check("photoRegionTag other state = mismatch", photoRegionTag("https://x.com/photos/colorado-front-range-map.jpg", region) === "mismatch");
    check("photoRegionTag opaque = unknown", photoRegionTag("https://lh3.googleusercontent.com/a/ACg8ocK", region) === "unknown");
    check("photoRegionTag city = match", photoRegionTag("https://x.com/img/spring-tx-unit.jpg", region) === "match");
  }

  process.exit(failures === 0 ? 0 : 1);
}

module.exports = {
  buildRegion,
  photoRegionTag,
  selectHeroPosterPhoto,
  applyHeroPosterPass,
  assertHeroPosterShips,
  heroPosterRels,
  injectPosterOnerror,
  resolveDonorPoster,
};

if (require.main === module && process.argv.includes("--test")) {
  runTests();
}
