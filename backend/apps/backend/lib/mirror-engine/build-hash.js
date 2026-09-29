"use strict";

// lib/mirror-engine/build-hash.js — idempotency + slug ownership.
//
// Idempotency is enforced by a memo table keyed on a canonical build_hash over
// {donor, donor_content_hash, normalized facts, brand asset hashes, hero,
// hydrator version} — NOT by Vercel (deployments are immutable; every deploy
// mints a new deploy_id, so "same deployment" is meaningless there).
//
// Slug ownership: same slug + different business_name is undefined behavior in
// the wild — business B's facts landing on business A's already-emailed URL.
// That is a 409 slug_conflict. The legitimate re-mirror path (same
// business_name, rating 4.8 -> 4.9) is allowed: new deployment, re-alias, same
// URL. A per-slug advisory lock serializes concurrent builds of one slug.
//
// State is in-memory per instance with an injectable store seam. In a
// serverless deployment each instance holds its own memo — that degrades
// idempotency to best-effort (a cache miss re-deploys identical bytes, which
// Vercel's file-hash dedup makes cheap) but slug-conflict detection MUST be
// durable before this lane wires into Ghost; the store seam is where that
// lands (store.js record, keyed mirror_engine_slug:<slug>).

const { createHash } = require("node:crypto");

// THE RENDERER'S IDENTITY. Do not version-bump this to invalidate a cache.
//
// It is what engine.js publishes as `renderer`, it is signed into the release
// evidence, and the whole point of lib/mirror-engine/verify.js's identity
// contract is that this string means "this tree was built by the Mirror
// Engine" and nothing else. Consumers compare it exactly.
const HYDRATOR_VERSION = "mirror-engine@v1";

// THE BUILD RECIPE. Bump this when an engine change alters the OUTPUT BYTES
// without altering the INPUTS.
//
// It participates in buildHash and nowhere else, which is the distinction the
// first version of this change missed: bumping HYDRATOR_VERSION would have
// busted the memo AND silently renamed the renderer in signed evidence, for a
// caching problem.
//
// 2026-08-11 · theme: light is the default and the palette is the client's
// (lib/mirror-engine/theme.js). Every existing mirror hashes on the same donor,
// facts and content it always did, so without this the first rebuild would hit
// the memo, return the old manifest, and the fleet would stay dark while the
// code claimed it was fixed.
//
// 2026-08-13 · brand recolour + reviews clamp + content relocation guard. Three
// engine changes since the last bump altered the OUTPUT BYTES of every mirror
// without touching any per-prospect INPUT: (1) the client's second brand colour
// now recolours accents (red→blue on Family Heating), (2) the reviews carousel
// clamps overflowing quote text, (3) RELOCATE_JS no longer re-parents the whole
// .wss-content wrapper into the first review card. Because none of these change
// donor/facts/brand/content, build_hash stayed identical — so both proof-shot
// reuse gates (line-proof-shots.storedShotIsCurrent, line-email-assets
// .assetsAreCurrent) saw "same build" and shipped the pre-fix RED screenshot,
// and the email's content cache-bust never moved, so Gmail served the cached
// red image forever. Bumping the recipe is the documented lever: it moves
// build_hash on every mirror, the reuse gates correctly miss, the send path
// re-photographs the now-blue page, and a changed pixel digest mints an <img>
// URL no proxy has seen. This is the "why aren't we re-photographing every
// time" answer — the system does, keyed on build_hash, which had gone deaf.
//
// 2026-08-14 (visual polish) · three more engine-output changes that touch every
// mirror's bytes without touching any per-prospect INPUT: (1) the hero scrim base
// is darkened heavily toward near-black BEFORE the wash walk, so the client video
// reads through a moody dark scrim instead of a flat blue smother; (2) donor
// editorial cruft (chapter/§/reel/field/kicker labels + the giant faint
// section-number watermark) is stripped from every build; (3) the light/dark
// toggle is docked off the mobile header. Same memo/proof-shot logic as every
// prior bump: without moving the recipe the reuse gates would ship the pre-fix
// screenshot, so the token grows.
//
// 2026-08-21 (contrast + extraction) · engine-output changes measured by the
// 2026-08-20 dual-viewport WCAG audit and the sandbox extraction audit, all
// input-invisible: (1) the two-worlds theme fix — every mode-scoped rule gains
// a `.dark` class twin and the boot/toggle scripts drive the class beside the
// attribute; (2) button/CTA ink is chosen per mode against that mode's own
// fill; (3) --gradient-hero stays dark in both modes so the forced-white hero
// ink can never sit on a near-white wash; (4) the service-plausibility filter
// refuses nav-lexicon labels, coupon fragments, raw URLs and duplicates;
// (5) review carousels never lead with a sub-4-star quote; (6) hours can never
// render "[object Object]"; (7) zero-valued stats are omitted from the data
// island; (8) forge-placeholder prose is blanked at render and BLOCKS at the
// token scan. Rebuilds must re-render, so the token grows.
// 2026-08-21b (donor token worlds) · the residual the live rebuild measured:
// ink/paper classifiers now resolve var() chains and color-mix (the plumbing
// `.text-slurry` indirection), utility harvest reads comma groups (concrete's
// `.bg-primary` band), and shadcn tokens ship per-token as triplet-or-hex to
// match how each donor consumes them (a bare triplet is an invalid colour in
// a direct-consuming v4 donor — transparent bands, fallback inks).
// 2026-09-02 (brand_identity render side) · the Google-Fonts <link> injection
// moved OUT of the content gate (a typeface belongs to the canvas, not to the
// copy — a captured or brand_identity font on a content-less build still has
// to load), so a build carrying brand.fonts and no content now ships the link
// it always needed. brand_identity itself (the extraction lane's palette
// override) is a NEW per-request input and hashes via its own payload key.
// 2026-09-02b (template diversification) · every mirror now ships a
// per-prospect component-variant selection (hero composition, CTA treatment,
// typography scale, donor section order — mirror-engine/component-variants.js)
// appended to the last stylesheet after the theme sheet. Same memo law as
// every prior bump: the selection changes the OUTPUT BYTES of every build
// without changing donor/facts/brand bytes, so the recipe grows to move
// build_hash and the reuse gates re-render instead of replaying the
// pre-diversification screenshot.
const BUILD_RECIPE_VERSION = "hero-cinematic-ink+badge-strip+logo-accent-truth+multi-trade-lead@2026-08-20b+contrast-two-worlds+service-plausibility@2026-08-21+donor-token-worlds@2026-08-21b+spa-gallery-js@2026-08-22+project-gallery+perf-pipeline@2026-09-02+brand-identity-palette@2026-09-02+template-diversify@2026-09-02b";

/** Deterministic stable stringify (sorted keys, no whitespace). */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/** sha256 over the donor's file tree: relpath + bytes, sorted. Donor dirs can
 *  drift under a stable name — this hash participates in build_hash and the
 *  manifest so a stale donor is detectable (donor_stale on mismatch). */
function donorContentHash(donorFiles) {
  const h = createHash("sha256");
  for (const rel of Object.keys(donorFiles).sort()) {
    h.update(rel);
    h.update("\0");
    h.update(donorFiles[rel]);
    h.update("\0");
  }
  return h.digest("hex");
}

function buildHash({ donor, donorHash, facts, phoneDigits, brandHashes = {}, hero = {}, content = {}, signup = null, edits = "", brandIdentity = null, sitePalette = null, variants = null }) {
  const h = createHash("sha256");
  const payload = {
    hydrator: HYDRATOR_VERSION,
    // The recipe, alongside the renderer identity rather than instead of it, so
    // an engine change that alters the output bytes misses the memo without
    // renaming the renderer in signed evidence.
    recipe: BUILD_RECIPE_VERSION,
    donor,
    donorHash,
    facts,
    phoneDigits,
    brandHashes,
    hero,
    // `content` MUST participate: it changes the bytes the customer receives
    // (services, FAQ, coverage, reviews, schema graph). Omitting it made two
    // builds differing only in content hash-identical, so a content-only fix
    // hit the memo, returned idempotent_replay, and never redeployed — the
    // same stale-state trap that wasted days on the old lane.
    content,
    // The sign-up panel is emitted into every content page. Its checkout URL
    // therefore changes index.html bytes and must move the hash. Only this SHA
    // leaves the engine; the signed URL itself is never copied into metadata.
    signup,
  };
  // THE CUSTOMER'S EDITS ARE PART OF THE BUILD. A voice edit changes the bytes
  // the customer receives exactly as much as a content change does, so a build
  // that replays one is a different build (lib/site-edit-log.js fingerprintOf).
  // Added only when there ARE edits, so every hash for an unedited site — which
  // is every prospect mirror — stays byte-identical to what it was before this
  // key existed.
  if (edits) payload.edits = edits;
  // BRAND_IDENTITY IS PART OF THE BUILD, for the same reason edits are. An
  // applied extraction verdict rewrites the palette, the header logo and the
  // display font — the bytes the customer receives. Added only when a verdict
  // was APPLIED (engine.js refuses LOW and absent accents before this point),
  // so every request without brand_identity hashes exactly as it always did.
  if (brandIdentity) payload.brand_identity = brandIdentity;
  // SITE_PALETTE IS PART OF THE BUILD for the same reason brand_identity is:
  // an applied whole-website verdict rewrites the surfaces, the ink, the slab
  // rhythm and possibly the accent — bytes the customer receives. Added only
  // when APPLIED, so every request without one (or with a colourless,
  // normalized-away one) hashes exactly as it always did.
  if (sitePalette) payload.site_palette = sitePalette;
  // THE COMPONENT-VARIANT SELECTION IS PART OF THE BUILD, for the same reason
  // brand_identity is: the hero composition, CTA treatment, typography scale
  // and section order change the bytes the customer receives, so a rebuild
  // with a different selection must never replay the old manifest. Unlike
  // edits/brand_identity this key is present on every mirror — the selection
  // applies unconditionally — which is also why BUILD_RECIPE_VERSION grew a
  // template-diversify token in the same change.
  if (variants) payload.variants = variants;
  h.update(canonical(payload));
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Memo + slug registry + advisory locks (instance-local, injectable)
// ---------------------------------------------------------------------------
function createRegistry() {
  const memo = new Map(); // build_hash -> result manifest
  const slugOwners = new Map(); // slug -> business_name (normalized)
  const locks = new Map(); // slug -> Promise chain tail
  const records = new Map(); // slug -> latest result manifest (GET /mirror status)
  // slug -> { slug, h1, title }. The IN-PROCESS half of the sameness fleet: a
  // batch builds many mirrors in one lambda, and two businesses in one city is
  // exactly where a shared headline shows up. The durable half is injected
  // (deps.fleetIdentities) because this map dies with the instance.
  const identities = new Map();
  // donor -> [{ prospectId, signature }] — the in-process half of the
  // template-diversification similarity budget (mirror-engine/
  // component-variants.js). Two prospects built from the same donor in one
  // batch is exactly where two same-looking sites show up; the registry keeps
  // each donor's recent variant selections so the next same-donor build can
  // prove it differs. Same durability posture as `identities`: instance-local
  // now, durable seam when this lane wires into Ghost.
  const variantRows = new Map();

  const normName = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

  return {
    memoGet: (hash) => memo.get(hash) || null,
    memoSet: (hash, result) => { memo.set(hash, result); },
    recordGet: (slug) => records.get(slug) || null,
    recordSet: (slug, result) => { records.set(slug, result); },

    /** Published identity of one slug, for the sameness gate. */
    identitySet: (slug, identity) => { identities.set(slug, { ...identity, slug }); },
    identityGet: (slug) => identities.get(slug) || null,
    /** Every OTHER slug's published identity. */
    identityAll: (exceptSlug) => [...identities.values()].filter((i) => i.slug !== exceptSlug),

    /**
     * Variant selections this instance has published per donor, for the
     * similarity budget. Only successful builds register (the engine calls
     * variantSet exactly where it calls identitySet), so a failed
     * experiment can never constrain the next prospect's look.
     */
    variantSet: (donor, row) => {
      const key = String(donor || "");
      if (!key || !row || !row.signature) return;
      const rows = variantRows.get(key) || [];
      const at = rows.findIndex((r) => r.prospectId === row.prospectId);
      if (at >= 0) rows.splice(at, 1);
      rows.push({ prospectId: String(row.prospectId || ""), signature: row.signature });
      while (rows.length > 8) rows.shift();
      variantRows.set(key, rows);
    },
    variantRows: (donor) => [...(variantRows.get(String(donor || "")) || [])],

    /**
     * Claim a slug for a business. Returns { ok:true } or
     * { ok:false, error:"slug_conflict", owner } when the slug is already
     * bound to a DIFFERENT business_name.
     */
    claimSlug(slug, businessName) {
      const owner = slugOwners.get(slug);
      const claimant = normName(businessName);
      if (owner && owner !== claimant) {
        return { ok: false, error: "slug_conflict", owner };
      }
      slugOwners.set(slug, claimant);
      return { ok: true };
    },

    /** Serialize work per slug. Usage: await registry.withSlugLock(slug, fn). */
    async withSlugLock(slug, fn) {
      const prev = locks.get(slug) || Promise.resolve();
      let release;
      const gate = new Promise((r) => { release = r; });
      locks.set(slug, prev.then(() => gate));
      await prev;
      try {
        return await fn();
      } finally {
        release();
        if (locks.get(slug) === gate) locks.delete(slug);
      }
    },

    _debug: { memo, slugOwners, identities, variantRows },
  };
}

// The default process-wide registry. Tests create their own.
const defaultRegistry = createRegistry();

module.exports = {
  HYDRATOR_VERSION,
  BUILD_RECIPE_VERSION,
  canonical,
  donorContentHash,
  buildHash,
  createRegistry,
  defaultRegistry,
};
