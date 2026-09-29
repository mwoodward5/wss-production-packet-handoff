"use strict";

// lib/mirror-engine/engine.js — the Mirror Engine orchestrator.
//
//   validate -> facts -> donor -> brand -> hydrate -> scans
//     -> (dry_run stops: manifest + build_hash, zero Vercel calls)
//     -> deploy -> READY -> byte-diff -> deep-link -> render/audit/sameness
//     -> ALIAS/ACTIVATE LAST
//
// OUTPUT/EVIDENCE CONTRACT (manager's addendum — the exact seam that broke
// the system before): the engine signs its own renderer identity. Every
// manifest carries renderer/qc_contract/evidence schema constants defined
// HERE, in the renderer, plus an evidence_sha binding the named check
// evidence to the build_hash. It is structurally impossible to stamp this
// output as SiteForge's: SiteForge's evidence schema is a different constant,
// and any consumer can recompute evidence_sha to detect a transplanted stamp.
// forge_job_mirror-style impersonation dies at this seam.
//
// Nothing downstream may mark a mirror sendable without revealable:true —
// and revealable is COMPUTED from named check evidence, never assigned.

const { createHash, createHmac } = require("node:crypto");
const { checkMirrorRequest } = require("./validate");
const { validateFacts, identityCopyFor, marketCity, addressCity } = require("./facts");
const samenessLib = require("./sameness");
const { resolveDonor, loadDonor } = require("./donor");
const { resolveBrandAssets, transcodePhoto } = require("./brand-assets");
const { hydrate, parseGate } = require("./hydrate");
const contentInject = require("./content-inject");
const authorityPages = require("./authority-pages");
const { buildLocalSearchPlan } = require("../local-search-plan");
const { tokenScan, identityScan } = require("./scan");
const clientIsolation = require("./client-isolation");
const { buildHash, canonical, createRegistry, defaultRegistry, HYDRATOR_VERSION } = require("./build-hash");
const {
  EVIDENCE_HMAC_KEY_ENV,
  evidenceHmacConfigured,
  signEvidence,
} = require("./evidence-signature");
const deployLib = require("./deploy");
const { localSiteGatewayOrigin } = require("../shared-site-release");
const lineTelemetry = require("../line-telemetry");
const routesLib = require("./routes");
const { renderCheck, renderAudit } = require("./verify");
const { verificationMode } = require("../light-verification");
const { brandWordmarkSvg } = require("../forge");
const { applyBrandToCss, applySurfaceToCss, applySecondaryToCss, applyLiteralHues, applyFontsToCss, enforcePairedForegroundContrast, imageDimensions, wcagContrast, wcagRelativeLuminance, hslTripletToRgb } = require("../capture-brand");
const { pickHeroPhoto, heroWashCss, heroTextCss, HERO_SUB_INK, scrimAlphaFor } = require("../hero-wash");
const heroMediaLib = require("./hero-media");
// THE HERO POSTER PASS (audit A1, 2026-09-03): the emitted hero-poster
// reference must provably resolve to bytes in the shipped bundle, the tile
// must be a real photograph (provenance- and region-gated, with the donor's
// own real poster as the neutral fallback), and a runtime miss must fall
// back to that bundled photo instead of a broken-image icon.
const heroPosterLib = require("./hero-poster");
const photoShipsLib = require("./photo-ships");
// THE HERO VIDEO PATHS PASS (final-qa Class D, 2026-09-04): the emitted
// video src/poster references must resolve to shipped bytes at every
// serving prefix — the walkers' `"/"+src` absolutization and the
// root-absolute paint-under/quoted forms are repaired at emit time, and a
// compile-time ships assertion (hero-poster's pattern, extended to the
// video ladder) heals any dangling reference before the build can ship.
const heroVideoPathsLib = require("./hero-video-paths");
// THE CLIMATE COPY GUARD (audit A1): a climate-specific claim authored into
// a donor's hero copy ("a 118-degree afternoon", "desert", "monsoon"…)
// ships only to builds whose region belongs to that claim's climate.
const { applyClimateCopyGuard } = require("./climate-copy-guard");
const { buildProspectId } = require("./media-provenance");
const { checkAccent } = require("../brand-default-detector.cjs");
const optimization108 = require("./optimization-108");
const { applyFavicons } = require("./favicon");
const theme = require("./theme");
const componentVariants = require("./component-variants");
const fleetPolish = require("./fleet-polish");
const { fenceAreasServed } = require("./area-fence");
const projectGallery = require("./project-gallery");
const perfPipeline = require("./perf-pipeline");
const { siteEditLog } = require("../site-edit-log");
const { replayEdits } = require("../site-edit-replay");

const RENDERER = HYDRATOR_VERSION; // "mirror-engine@v1"
const QC_CONTRACT = "mirror-engine-qc-v1";
const EVIDENCE_SCHEMA = "mirror-engine-release-evidence-v1";

function err(status, error, detail) {
  return { ok: false, status, body: { ok: false, error, ...(detail ? { detail } : {}) } };
}

/**
 * #rgb/#rrggbb -> {r,g,b}, or null. Local twin of hero-wash's internal
 * parseHex: the hero contrast floor needs the VEIL's own components to paint
 * the banded rgba() gradient in the colour the alpha was proven for.
 */
function parseHexColor(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/**
 * Button-label ink for a theme override sheet — ONE RULE PER MODE, each scoped.
 *
 * The first version read the LAST `--primary:` triplet in the sheet and
 * shipped one UNSCOPED rule. The theme sheet declares the token twice — the
 * default mode's value first, the toggle counterpart's second — so "last"
 * always meant the COUNTERPART palette, and the ink chosen against a dark
 * counterpart primary shipped unscoped into light mode too. The 2026-08-20
 * WCAG audit measured the result on live headers: phone pills and tel buttons
 * illegible in BOTH modes, because one mode's correct ink is the other mode's
 * invisible one.
 *
 * Now each declaration is read in the order themeCss writes them (default
 * first, counterpart second), the ink is chosen against the fill that mode
 * actually paints, and the emitted rule is scoped to that mode with the
 * class-twin discipline (theme.modeScopePrefixes — [data-wss-theme] AND the
 * shadcn `.dark` class world). `--accent` fills get the same treatment: the
 * audit found white CTA labels on a light lime accent at 1.65:1.
 *
 * Returns "" when the sheet declares neither token — most callers pass the
 * theme sheet, which always does — so this stays inert everywhere else.
 */
function buttonInkRuleForSheet(sheet, defaultMode = "light") {
  const src = String(sheet || "");
  const counterpartMode = defaultMode === "dark" ? "light" : "dark";
  // The sheet spells a token as a bare triplet for a shadcn donor and as a
  // real hex for a direct-consuming v4 donor (theme.js tokenColor) — both
  // spellings are this rule's business.
  const valuesOf = (token) => [...src.matchAll(
    new RegExp(`--${token}\\s*:\\s*(-?[\\d.]+\\s+[\\d.]+%\\s+[\\d.]+%|#[0-9a-fA-F]{6})`, "g"),
  )].map((m) => m[1]);
  // A `.bg-<token>` the theme has REPOINTED to the slab already wears the
  // slab's own contrast-checked ink (slabRules pairs them); forcing the
  // TOKEN-fill's ink on top with !important would fight that pairing — light
  // ink on the pale light-mode slab. Skip the token instead: the slab pair is
  // the correct authority wherever it painted.
  const slabRepointed = (cls) => {
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[2].includes("var(--wss-slab)")) continue;
      if (m[1].split(",").some((s) => s.trim() === cls)) return true;
    }
    return false;
  };
  const rules = [];
  const emit = (token, selectors) => {
    const decls = valuesOf(token);
    if (!decls.length) return;
    const perMode = [[defaultMode, decls[0]]];
    if (decls.length > 1) perMode.push([counterpartMode, decls[decls.length - 1]]);
    for (const [mode, value] of perMode) {
      // wcagRelativeLuminance takes the [r,g,b] ARRAY form hslTripletToRgb
      // returns; parseHexColor returns {r,g,b} and is reshaped to match.
      const hex = value.startsWith("#") ? parseHexColor(value) : null;
      const fill = hex ? [hex.r, hex.g, hex.b] : hslTripletToRgb(value);
      if (!fill) continue;
      const dark = wcagRelativeLuminance(fill) < 0.35;
      const ink = dark ? "0 0% 98%" : "240 6% 10%";
      rules.push(
        `${theme.scopeSelectors(theme.modeScopePrefixes(mode, defaultMode), selectors)}{color:hsl(${ink})!important}`,
      );
    }
  };
  // `[class*="bg-primary"]` also matches the ALPHA variants ("bg-primary/10"
  // — the header phone pill), whose painted surface is the page tint, not the
  // primary fill; forcing the fill's ink onto a 10% tint is the invisible-pill
  // defect in one selector. The :not guard leaves every alpha step to the
  // theme's own token maths.
  if (!slabRepointed(".bg-primary")) {
    emit("primary", [".bg-primary", ".bg-primary *", '[class*="bg-primary"]:not([class*="bg-primary/"])']);
  }
  if (!slabRepointed(".bg-accent")) {
    emit("accent", [".bg-accent", ".bg-accent *", ".bg-gradient-accent", ".bg-gradient-accent *"]);
  }
  if (!rules.length) return "";
  return [
    "/* wss-button-ink: label chosen by contrast against EACH mode's own fill,",
    " scoped per mode (attr + .dark class twin) so neither mode wears the other's ink. */",
    ...rules,
  ].join("");
}

/** Why a resume candidate was accepted or refused. Filenames and byte lengths
 *  only — never file content. Gated like the other engine/deploy phase logs. */
function logResumeDecision(source, resume, probe) {
  if (!(process.env.VERCEL || process.env.GHOST_AGENCY_PHASE_LOGS === "true")) return;
  // Observability volume valve (#596): `reduced` keeps only unclean probes —
  // the "resume refused, here is why" line. A clean resume is the happy path.
  if (!lineTelemetry.shouldLogMirrorResume(process.env, probe)) return;
  try {
    console.log(JSON.stringify({
      event: "mirror_resume",
      source: (resume && resume.source) || source,
      found: Boolean(resume && resume.found),
      clean: Boolean(probe && probe.clean),
      transient: (probe && probe.transient) || null,
      mismatches: ((probe && probe.diff && probe.diff.mismatches) || []).slice(0, 3),
      deep_failures: ((probe && probe.deep && probe.deep.failures) || []).slice(0, 3),
    }));
  } catch { /* diagnostics must never affect a build */ }
}

function transientProbeFailure(diff, deep) {
  const reasons = [
    ...((diff && diff.mismatches) || []).map((item) => item && item.reason),
    ...((deep && deep.failures) || []).map((item) => item && item.reason),
  ].filter(Boolean).map(String);
  return reasons.find((reason) => /^http_(?:0|408|425|429|5\d\d)$/.test(reason)) || null;
}

function sharedPublisherSelection(deps, env = process.env) {
  // Exact "0" is the emergency return to the legacy per-site Vercel lane.
  // Missing means ON, but only an explicitly injected publisher selects the
  // shared lane; this engine owns no provider credentials or adapter.
  if (String(env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT || "") === "0") return { selected: false };
  if (!Object.prototype.hasOwnProperty.call(deps, "sharedPublisher")) return { selected: false };
  const publisher = deps.sharedPublisher;
  if (!publisher
    || publisher.supportsTwoPhaseQc !== true
    || typeof publisher.stage !== "function"
    || typeof publisher.activate !== "function") {
    return { selected: true, error: "shared_publisher_invalid" };
  }
  return { selected: true, publisher };
}

function exactSharedPreviewUrl(value, host) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (_) {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== host || url.port || url.username || url.password
    || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    return null;
  }
  return `${url.origin}/`;
}

function normalizeSharedProofIdentity(value, buildHash) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !String(value.site_id || "").trim()
    || !String(value.release_id || "").trim()
    || value.build_hash !== buildHash) return null;
  return {
    site_id: value.site_id,
    release_id: value.release_id,
    build_hash: value.build_hash,
  };
}

function sharedStageFailureReason(value) {
  const base = String(value?.reason || "shared_stage_refused");
  // Keep only a strict provider code. Arbitrary provider text may carry object
  // paths or other release details and must not enter an operator verdict.
  const detail = String(value?.detail?.error || "").trim();
  return /^[a-z0-9_.:-]{1,160}$/i.test(detail) ? `${base}:${detail}` : base;
}

function normalizeSharedStage(value, { host, buildHash }) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.ok !== true) {
    return { ok: false, reason: sharedStageFailureReason(value) };
  }
  const previewUrl = exactSharedPreviewUrl(value.previewUrl, host);
  if (!previewUrl) return { ok: false, reason: "shared_preview_identity_mismatch" };
  const proofIdentity = normalizeSharedProofIdentity(value.proofIdentity, buildHash);
  if (!proofIdentity) return { ok: false, reason: "shared_proof_identity_invalid" };
  if (typeof value.openPreview !== "function") {
    return { ok: false, reason: "shared_preview_opener_invalid" };
  }
  return { ok: true, previewUrl, proofIdentity, receipt: value };
}

function normalizeOpenedPreview(value, { host }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "shared_preview_invalid" };
  }
  // LOCAL PREVIEW SEAM: under the local shared-site environment the
  // publisher's openPreview resolves against the local site-router gateway
  // (https://<slug>.local.wss-ai.test:5444) instead of the canonical
  // production host — the two name the SAME release. Outside local the
  // canonical-host rule is exactly as strict as before.
  const slug = host.endsWith(".wss-ai.com") ? host.slice(0, -".wss-ai.com".length) : "";
  const localGatewayOrigin = slug ? localSiteGatewayOrigin(slug) : "";
  const canonicalOrigin = exactSharedPreviewUrl(value.origin, host);
  const origin = canonicalOrigin
    || (localGatewayOrigin && String(value.origin || "") === localGatewayOrigin ? localGatewayOrigin : null);
  if (!origin) return { ok: false, reason: "shared_preview_identity_mismatch" };
  if (typeof value.fetch !== "function" || typeof value.preparePage !== "function") {
    return { ok: false, reason: "shared_preview_capability_invalid" };
  }
  return { ok: true, origin, fetch: value.fetch, preparePage: value.preparePage };
}

async function openSharedPreview(stage, { host, signal, deadlineAt }) {
  const opened = await stage.receipt.openPreview({ signal, deadlineAt });
  return normalizeOpenedPreview(opened, { host });
}

function normalizeSharedPublication(value, { host, buildHash, stagedProofIdentity }) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.ok !== true) {
    return { ok: false, reason: String((value && value.reason) || "shared_activation_refused") };
  }
  const previewUrl = exactSharedPreviewUrl(value.previewUrl, host);
  if (!previewUrl) return { ok: false, reason: "shared_preview_identity_mismatch" };
  const proofIdentity = value.proofIdentity;
  const releaseEvidence = value.releaseEvidence;
  const normalizedProof = normalizeSharedProofIdentity(proofIdentity, buildHash);
  if (!normalizedProof) {
    return { ok: false, reason: "shared_proof_identity_invalid" };
  }
  if (stagedProofIdentity && (
    stagedProofIdentity.site_id !== normalizedProof.site_id
    || stagedProofIdentity.release_id !== normalizedProof.release_id
    || stagedProofIdentity.build_hash !== normalizedProof.build_hash
  )) return { ok: false, reason: "shared_activation_identity_mismatch" };
  if (!releaseEvidence || typeof releaseEvidence !== "object" || Array.isArray(releaseEvidence)
    || releaseEvidence.site_id !== normalizedProof.site_id
    || releaseEvidence.release_id !== normalizedProof.release_id
    || releaseEvidence.build_hash !== buildHash
    || releaseEvidence.canonical_host !== host) {
    return { ok: false, reason: "shared_release_evidence_invalid" };
  }
  return {
    ok: true,
    previewUrl,
    proofIdentity: normalizedProof,
    releaseEvidence: { ...releaseEvidence },
  };
}

/** Compute revealable strictly from named evidence. TRUTH gates must all exist
 *  and have passed; "pending"/"unavailable"/missing all keep it false. POLISH
 *  gates never block — the owner's doctrine, 2026-08-20, after seven real
 *  line refusals in one night were all this class (a prose-lint connector, an
 *  unmeasured hero, a missing service list): "light audit, get out on the
 *  road." Polish failures land in the manifest as polish_flags, visible to the
 *  operator, fixed before send — never a dead build. */
const REQUIRED_TRUTH_CHECKS = Object.freeze([
  "hydration_parse", "token_scan", "identity_scan", "brand", "asset_diff",
  "deep_link", "alias_target", "hero_provenance", "logo_identity", "critical_visual",
  // A mirror that reads like somebody else's is not this business's website.
  // 32 of the 80 built-and-unsent mirrors shared one h1 and one served title;
  // that is now a build failure, measured on the donor's bytes, on the served
  // <head> and on the rendered DOM. See lib/mirror-engine/sameness.js.
  "sameness",
]);
const POLISH_CHECKS = Object.freeze(["render", "routes", "route_render"]);

function computeRevealable(checks) {
  return REQUIRED_TRUTH_CHECKS.every((name) => checks[name] && checks[name].status === "passed");
}

function polishFlags(checks) {
  const flags = POLISH_CHECKS
    .filter((name) => checks[name] && checks[name].status !== "passed")
    .map((name) => ({ name, status: checks[name].status, cause: checks[name].cause || null }));
  if (checks.brand && checks.brand.mark_fallback) {
    flags.push({
      name: "brand_mark_fallback",
      status: "fallback",
      cause: checks.brand.mark_fallback,
    });
  }
  return flags;
}

/**
 * The phone as a HUMAN reads it. `facts.phone` is E.164 (+19047607837) because
 * that is the correct machine form for schema and for a tel: href — but it was
 * also the token donors printed as VISIBLE TEXT, so the header button, the hero
 * call-to-action and the footer all read "+19047607837". No business displays
 * its number that way; it is machine output sitting in the most important
 * element on the page. Rendering falls back to the original string for anything
 * that is not a NANP number, so an international line is never mangled.
 */
function displayPhone(value) {
  const raw = String(value || "").trim();
  const d = raw.replace(/[^0-9]/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function parseHexColor(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

// THE CINEMATIC DARK SCRIM (owner, on the live Family Heating hero: the video is
// "buried under a flat blue"). The hero wash walks its scrim from the colour it
// is GIVEN toward a dark anchor, and stops the instant white text passes — so
// handing it the raw brand accent stops at step 0, painting the accent itself
// (#005DAC) at ~0.92 alpha: a flat blue smother over the client's video. The fix
// is upstream of the walk: give it a scrim base that is ALREADY near-black, so
// the proven scrim is dark (the video shows through) while a hint of the client
// hue survives. Blend 85% toward #0b1220. An empty/garbage accent collapses to
// the pure dark anchor, which is exactly the right fallback.
const SCRIM_ANCHOR = { r: 11, g: 18, b: 32 }; // #0b1220
function darkenForScrim(hex) {
  const c = parseHexColor(hex);
  if (!c) return "#0b1220";
  const t = 0.85;
  const mix = {
    r: Math.round(c.r * (1 - t) + SCRIM_ANCHOR.r * t),
    g: Math.round(c.g * (1 - t) + SCRIM_ANCHOR.g * t),
    b: Math.round(c.b * (1 - t) + SCRIM_ANCHOR.b * t),
  };
  return "#" + [mix.r, mix.g, mix.b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// DONOR EDITORIAL CRUFT. The magazine-styled donors stamp meaningless scaffolding
// onto every section — chapter marks ("Ch. 02 — Comfort Dial"), section numbers
// ("§02", "§ Field card · 01"), reel/field/read-time badges ("Reel · 042",
// "Field · 18:42", "Read time · 12s") and interactive kickers ("The Comfort Dial
// · Interactive"). None of it is client content; on the live Family Heating hvac
// mirror it reads as sloppy donor residue. These donors are client-rendered SPAs
// (empty #root), so the text lives ONLY as string literals in the JS bundle —
// blank the literal, never the surrounding structure, so the element collapses to
// nothing and a donor without these strings is byte-identical. Replacing a
// complete "..." literal with "" cannot change JS syntax: the position still
// holds a valid string literal.
//
// Surgical by construction:
//  - only the three decorative prop keys (kicker/chapter/marginalia) are blanked,
//    and only when their VALUE actually looks editorial (carries · § or "Ch. N");
//  - bare badge literals are matched by their own distinctive shape (leading §,
//    or a Reel/Field/Read-time "· number" stamp).
// Real content (service names, tag lines, FAQ, the "Heat/Cool/Balance" dial
// labels) carries none of these markers and is left untouched.
function stripDonorCruft(files) {
  const decorVal = /[·§]|\bCh\.\s*\d/;
  const KEYED = /\b(kicker|chapter|marginalia):"((?:[^"\\]|\\.)*)"/g;
  const SECTION = /"(§(?:[^"\\]|\\.)*)"/g;
  const BADGE = /"((?:Reel|Field|Read time)\s*·(?:[^"\\]|\\.)*)"/gi;
  let blanked = 0;
  for (const rel of Object.keys(files)) {
    if (!/\.(js|html)$/i.test(rel)) continue;
    const before = files[rel].toString("utf8");
    let after = before.replace(KEYED, (m, key, val) => (decorVal.test(val) ? (blanked++, `${key}:""`) : m));
    after = after.replace(SECTION, () => (blanked++, '""'));
    after = after.replace(BADGE, () => (blanked++, '""'));
    if (after !== before) files[rel] = Buffer.from(after, "utf8");
  }
  return { blanked };
}

// FORGE PLACEHOLDER PROSE. The medspa donor ships template fallback copy whose
// SENTENCES admit they are template fallback copy — "This placeholder copy
// describes the practice's philosophy and credentials — the forge engine
// replaces it with the client's real narrative." — and on a live sandbox build
// (Glo Med Spa, 2026-08-20) that sentence shipped VERBATIM as the client's own
// About section, because the island carried no about text and the donor's
// fallback rendered. A page that tells the prospect it is a template is worse
// than a page with no About section, so the literals are blanked here (same
// mechanics as stripDonorCruft: a complete "..." literal becomes "", which
// cannot change JS syntax, and the donor's empty-string guards collapse the
// block) — and lib/mirror-engine/scan.js now BLOCKS any build whose hydrated
// output still carries one, so a future donor cannot re-ship the class.
//
// The markers are prose phrases ("placeholder copy", "forge engine", "lorem
// ipsum"), never the bare word "placeholder" — Tailwind's placeholder-color
// utilities and <input placeholder=…> are code, not copy, and stay untouched.
const FORGE_PLACEHOLDER_MARKER = /placeholder\s+copy|forge\s+engine|lorem\s+ipsum/i;

function stripForgePlaceholders(files) {
  const LITERAL = /"((?:[^"\\\n]|\\.)*)"/g;
  let blanked = 0;
  for (const rel of Object.keys(files)) {
    if (!/\.(js|html)$/i.test(rel)) continue;
    const before = files[rel].toString("utf8");
    if (!FORGE_PLACEHOLDER_MARKER.test(before)) continue;
    const after = before.replace(LITERAL, (m, val) => (FORGE_PLACEHOLDER_MARKER.test(val) ? (blanked++, '""') : m));
    if (after !== before) files[rel] = Buffer.from(after, "utf8");
  }
  return { blanked };
}

/** Append a CSS block to the last-sorted stylesheet, the same seam the theme and
 *  hero-wash passes use so source order (and thus the cascade) is predictable.
 *  Returns the stylesheet path, or null when the donor ships no CSS. */
function appendToLastCss(files, css) {
  const cssRels = Object.keys(files).filter((r) => /\.css$/i.test(r)).sort();
  const target = cssRels[cssRels.length - 1];
  if (!target) return null;
  files[target] = Buffer.from(`${files[target].toString("utf8")}\n${css}`, "utf8");
  return target;
}

/** A3(C) — THE HERO-TILE ASPECT. The split-hero donors pin their `.hero-visual`
 *  tile to a 4:5 portrait card (their own mobile rule relaxes it to 16:10). A
 *  landscape client poster cover-cropped into that portrait tile reads as a
 *  cropping bug — the "photo crammed into a sub-region" look (Earth Power,
 *  620x410 into a 486x608 tile). The tile's <img> src names bytes that SHIPPED
 *  in this build, so the placed photograph's real dimensions are measurable
 *  here (header-only, the `imageDimensions` sniff the logo gates already
 *  use). When the tile's
 *  photo is landscape, the donor's OWN mobile ratio (16/10) is promoted to all
 *  viewports — the design's language, not a new shape — and the img's
 *  width/height attributes are corrected to the real pixels so the browser
 *  reserves the true box (no layout shift at decode). Portrait photos and
 *  unmeasurable/absent bytes keep the 4:5 design tile untouched. Returns a
 *  small audit report. */
function applyHeroTileAspect({ files }) {
  const report = { applied: false, landscape: false, pages: 0, img_attrs_fixed: 0, stylesheet: null, photo: null };
  // `<div class="…hero-visual…"><img …>` — the img tag immediately inside the
  // tile (the donors' split composition; no intermediate wrapper).
  const TILE_RE = /class\s*=\s*(["'])[^"']*\bhero-visual\b[^"']*\1[^>]*>\s*<img\b([^>]*?)\s*\/?>/gi;
  const resolve = (rawSrc) => {
    let src = String(rawSrc || "");
    try { src = decodeURIComponent(src); } catch { /* keep raw */ }
    return src.replace(/^\/+/, "").split(/[?#]/)[0];
  };
  const measure = (rel) => {
    const buf = files[rel];
    if (!Buffer.isBuffer(buf) || !buf.length) return null;
    const dims = imageDimensions(buf);
    return dims && dims.width && dims.height ? { width: dims.width, height: dims.height } : null;
  };
  const fixAttrs = (attrs, photo) => {
    let next = attrs;
    const w = String(photo.width || "");
    const h = String(photo.height || "");
    if (!w || !h) return { next, fixed: 0 };
    let fixed = 0;
    if (/\bwidth\s*=\s*("[^"]*"|'[^']*')/i.test(next)) next = next.replace(/\bwidth\s*=\s*("[^"]*"|'[^']*')/i, `width="${w}"`);
    else { next += ` width="${w}"`; fixed++; }
    if (/\bheight\s*=\s*("[^"]*"|'[^']*')/i.test(next)) next = next.replace(/\bheight\s*=\s*("[^"]*"|'[^']*')/i, `height="${h}"`);
    else { next += ` height="${h}"`; fixed++; }
    return { next, fixed };
  };
  for (const [rel, bytes] of Object.entries(files)) {
    if (!/\.html?$/i.test(rel)) continue;
    const html = bytes.toString("utf8");
    if (!/\bhero-visual\b/.test(html)) continue;
    let touched = false;
    const next = html.replace(TILE_RE, (whole, quote, attrs) => {
      const srcMatch = attrs.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
      if (!srcMatch) return whole;
      const photo = measure(resolve(srcMatch[2]));
      if (!photo || !(photo.width > photo.height)) return whole; // portrait/square keeps the design tile
      report.landscape = true;
      report.photo = photo;
      const fixed = fixAttrs(attrs, photo);
      report.img_attrs_fixed += fixed.fixed;
      touched = true;
      return whole.replace(attrs, () => fixed.next);
    });
    if (touched) {
      files[rel] = Buffer.from(next, "utf8");
      report.pages++;
    }
  }
  if (report.landscape) {
    const cssRel = appendToLastCss(files, [
      "",
      "/* --- wss hero tile aspect: landscape client poster (A3) — the donor's",
      "   own mobile 16/10 promoted to all viewports so a landscape photograph",
      "   is not cover-cropped into the 4:5 portrait design tile. ----------- */",
      ".hero-visual { aspect-ratio: 16 / 10; }",
      "",
    ].join("\n"));
    report.stylesheet = cssRel;
    report.applied = Boolean(cssRel);
  }
  return report;
}

/** Exact compiled-file seam for the fleet polish pass. SPA gallery data lives
 * in first-party JS bundles, not in index.html; keeping this selection in one
 * tested helper prevents the renderer from silently starving the JS repair. */
function fleetPolishInputFiles(files) {
  const output = {};
  for (const [rel, bytes] of Object.entries(files || {})) {
    if (!/\.(?:html|css|js(?:\.raw)?)$/i.test(rel)) continue;
    output[rel] = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  }
  return output;
}

// The donor advertises a video ladder as data, but the built tree is the only
// authority on whether a rung exists.  Leaving a missing `hero-client-*` path
// first in that island made browsers recover to the fallback after a 404 while
// the release record falsely described client media.  Keep only real bytes in
// the immutable tree and bind the selected first rung to a small, auditable
// provenance vocabulary.
function declaredHeroProvenance(value, outputSha256) {
  const proof = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!proof) return { ok: true, provenance: "verified_client_media" };
  const kind = String(proof.kind || "");
  if (kind === "client_derived_reel"
    && String(proof.generator || "")) {
    return { ok: true, provenance: kind };
  }
  if (kind === "seedance_generated"
    && proof.checkpoint_schema === "wss.hero.seedance_provider_checkpoint.v1"
    && String(proof.provider_job_id || "")
    && String(proof.hero_job_id || "")
    && String(proof.attempt_id || "")
    && String(proof.output_sha256 || "").toLowerCase() === outputSha256) {
    return { ok: true, provenance: kind };
  }
  // No boomerang worker currently writes an immutable transform receipt.  A
  // claimed boomerang is therefore an invalid declaration, not Seedance.
  return { ok: false, reason: "hero_provenance_evidence_invalid" };
}

function finalizeHeroArtifact({ files, manifest, heroVideoSlot, heroVideoPlaced, heroVideoProvenance, heroWashApplied }) {
  const declared = manifest && manifest.hero_video && typeof manifest.hero_video === "object"
    ? manifest.hero_video : {};
  const fallbackSlot = String(declared.wss_fallback_clip_path || declared.fallback_clip_path || "").replace(/^\/+/, "");
  const clientSlot = String(heroVideoSlot || declared.client_video_path || "").replace(/^\/+/, "");
  const has = (rel) => Boolean(rel && Buffer.isBuffer(files[rel]) && files[rel].length > 0);
  // A donor can carry old template bytes at the client path.  It is client
  // media only when this build placed verified bytes there.
  const preferred = heroVideoPlaced === 1 && has(clientSlot) ? clientSlot : "";
  const fallback = has(fallbackSlot) ? fallbackSlot : "";
  // A3 (2026-09-03) — STOCK-FALLBACK SUPPRESSION. When the client's own
  // PHOTOGRAPH owns the hero (the hero wash painted: heroWashApplied) and no
  // client clip shipped, the ladder must not arm the donor's GENERIC STOCK
  // loop over it — the runtime mounts <video data-hero-video hidden>, the
  // walker sets the stock src, and on loadeddata (~2s cold) the clip
  // hard-cuts full-bleed over the client-photo hero: the owner-visible
  // "hero bugs out and swaps to the older hero" double-render (Earth Power,
  // hvac-premier). The photo hero IS the hero: the ladder ships deliberately
  // EMPTY with an explicit suppressed verdict (status stays "passed" — the
  // truth gate reads an empty ladder as a defect only when it is not
  // deliberate). The walker's empty-rungs return never arms, and the
  // fail-safe net below removes the dormant mount, so there is no fetch, no
  // swap, and nothing for the render gate to misread as a stalled video.
  // A real client clip outranks this suppression (the ladder stays intact);
  // a build with no photo hero keeps the stock rung — it is that build's
  // only motion surface.
  const stockFallbackSuppressed = Boolean(heroWashApplied) && !preferred;
  const sources = stockFallbackSuppressed
    ? []
    : [preferred, fallback].filter((value, index, all) => value && all.indexOf(value) === index);
  let ladders = 0;
  for (const [rel, bytes] of Object.entries(files)) {
    if (!/\.(?:html?|js)$/i.test(rel)) continue;
    const before = bytes.toString("utf8");
    const after = before.replace(/(<script\b[^>]*\bid\s*=\s*(["'])hero-video-ladder\2[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (whole, open, quote, json, close) => {
        let parsed = {};
        try { parsed = JSON.parse(json); } catch { return whole; }
        const next = { ...parsed, sources };
        ladders++;
        return `${open}${JSON.stringify(next)}${close}`;
      });
    if (after !== before) files[rel] = Buffer.from(after, "utf8");
  }
  // THE FAIL-SAFE NET UNDER EVERY LADDER (2026-09-02 fleet audit: a hero clip
  // that failed could leave a black element painted over the page). Every HTML
  // page that declares a ladder also gets, engine-side:
  //   · CSS that makes the marked video's own `hidden` attribute and the
  //     walkers' terminal `data-hero-dead` flag mean display:none even where a
  //     donor preflight resets `video { display: block }`;
  //   · a last-resort error listener: when a marked video errors and is STILL
  //     holding the failed source after 1.5s — no walker stepped it down, no
  //     rung armed — the element is hidden so the donor's hero image/color
  //     paints instead. A walker that steps down (src changes) or arms
  //     (data-hero-armed) within the window is left alone.
  let failsafePages = 0;
  const heroFailSafe = heroVideoFailSafeSnippet();
  for (const [rel, bytes] of Object.entries(files)) {
    if (!/\.(?:html?)$/i.test(rel)) continue;
    const html = bytes.toString("utf8");
    if (!/id\s*=\s*(["'])hero-video-ladder\1/.test(html) || html.includes("data-wss-hero-failsafe")) continue;
    if (!html.includes(heroFailSafe)) {
      const next = html.includes("</body>")
        ? html.replace(/<\/body>/i, `${heroFailSafe}</body>`)
        : html.replace(/<\/head>/i, `${heroFailSafe}</head>`);
      if (next !== html) {
        files[rel] = Buffer.from(next, "utf8");
        failsafePages++;
      }
    }
  }
  const selected = sources[0] || "";
  const declaredLadder = Boolean(clientSlot || fallbackSlot);
  const sha256 = selected ? createHash("sha256").update(files[selected]).digest("hex") : null;
  const declaredProof = selected === clientSlot
    ? declaredHeroProvenance(heroVideoProvenance, sha256)
    : { ok: true, provenance: selected === fallbackSlot ? "wss_static_fallback" : null };
  const status = stockFallbackSuppressed || ((!declaredLadder || selected) && declaredProof.ok) ? "passed" : "failed";
  return {
    status,
    source_count: sources.length,
    sources,
    ladder_count: ladders,
    failsafe_pages: failsafePages,
    path: selected || null,
    sha256,
    provenance: stockFallbackSuppressed
      ? "suppressed_for_client_photo_hero"
      : (declaredProof.ok ? declaredProof.provenance : null),
    ...(stockFallbackSuppressed ? {
      stock_fallback_suppressed: true,
      // The rung that was withheld, for the fleet audit: the deliberate
      // empty ladder names exactly what it refused to ship over the
      // client's photograph.
      suppressed_fallback: fallback || null,
    } : {}),
    ...(status === "failed" ? { reason: declaredProof.reason || "declared_hero_ladder_has_no_immutable_asset" } : {}),
  };
}

/**
 * The engine-side hero-video fail-safe net, injected next to every declared
 * ladder. Marker attribute is `data-wss-hero-failsafe` (the donor templates'
 * own paint-under style blocks carry `data-wss-hero-fallback`); both may be
 * present on one page — the net is the LAST line of defense, for a page whose
 * walker is missing, older than its ladder, or defeated by a preflight.
 */
function heroVideoFailSafeSnippet() {
  const css = `video[data-hero-video][hidden]{display:none!important}video[data-hero-video][data-hero-dead]{display:none!important}`;
  const js = `(function(){try{if(window.wssHeroFailsafe)return;window.wssHeroFailsafe="1";`
    + `document.addEventListener("error",function(e){var v=e&&e.target;if(!v||v.tagName!=="VIDEO"||!v.hasAttribute("data-hero-video"))return;`
    + `var src=v.getAttribute("src");`
    + `setTimeout(function(){if(v.isConnected&&v.getAttribute("src")===src&&!v.hasAttribute("data-hero-armed")&&!v.hasAttribute("data-hero-dead")){v.setAttribute("data-hero-dead","1");try{v.hidden=true}catch(x){}}},1500);`
    + `},true);}catch(e){}})();`
    // A3 (2026-09-03) — THE EMPTY-LADDER NET. A ladder island whose sources
    // array is DELIBERATELY empty (stock-fallback suppression over a client
    // photo hero) can never arm anything, but the deferred mount bundles
    // still mount <video data-hero-video hidden> with no src — a dormant
    // element the render gate would read as a stalled hero video. The net
    // reads the island once at load and, only for a parseable EMPTY sources
    // array, removes every marked mount (immediately and on late SPA mounts,
    // capped like the walker's own observer). An unparseable island proves
    // nothing and is left alone; a populated island never triggers it, so
    // edit-time clip injection (which repopulates the island and reloads)
    // keeps the full ladder behavior.
    + `(function(){try{var rungs=null;var isl=document.getElementById("hero-video-ladder");`
    + `if(isl){var p=JSON.parse(isl.textContent||"{}");if(p&&Array.isArray(p.sources))rungs=p.sources;}`
    + `if(rungs&&rungs.length===0){var sweep=function(){var vs=document.querySelectorAll("video[data-hero-video]");`
    + `for(var i=0;i<vs.length;i++)vs[i].remove();};sweep();`
    + `var mo=new MutationObserver(function(){sweep();});mo.observe(document.documentElement,{childList:true,subtree:true});`
    + `setTimeout(function(){mo.disconnect();},20000);}}catch(e){}})();`;
  return `<style data-wss-hero-failsafe>${css}</style><script data-wss-hero-failsafe>${js}</script>`;
}

/**
 * Coordinates a person might actually see. Google returns full float precision
 * and the donor printed it as body copy — "LAT 30.417309699999997" is IEEE-754
 * noise rendered as design. Six decimals is ~11cm, far past what any map needs.
 */
function displayCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Number(n.toFixed(6))) : "";
}

const DARK_HEADER_LOGO_VERTICALS = new Set(["fencing", "roofing", "construction", "general contractor", "concrete"]);

function needsDarkHeaderLogoContrast({ donor = "", vertical = "" } = {}) {
  const d = String(donor || "").toLowerCase();
  const v = String(vertical || "").toLowerCase();
  return DARK_HEADER_LOGO_VERTICALS.has(v)
    || d.includes("fencing")
    || d.includes("roofing")
    || d.includes("contractor")
    || d.includes("construction")
    || d.includes("concrete");
}

function reservePreHydrationLayout(files) {
  const css = '<style id="wss-prehydration-layout-css">#root{min-height:100vh}[data-wss-prehydration-layout]{min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr);gap:clamp(24px,5vw,56px);align-items:center;padding:clamp(96px,14vw,152px) clamp(20px,6vw,72px) clamp(48px,8vw,96px);box-sizing:border-box;background:linear-gradient(135deg,var(--wss-slab,#111827),var(--wss-accent,#334155));color:var(--wss-slab-ink,#fff)}[data-wss-prehydration-copy]{min-height:clamp(220px,32vw,420px);border-radius:28px;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}[data-wss-prehydration-widget]{min-height:clamp(260px,34vw,460px);border-radius:28px;background:rgba(255,255,255,.12);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}@media (min-width:900px){[data-wss-prehydration-layout]{grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr)}}@media (prefers-reduced-motion:no-preference){[data-wss-prehydration-layout]{content-visibility:auto;contain-intrinsic-size:900px}}</style>';
  const shell = '<div data-wss-prehydration-layout aria-hidden="true"><div data-wss-prehydration-copy></div><div data-wss-prehydration-widget></div></div>';
  let pages = 0;
  let skippedStaticH1 = 0;
  for (const rel of Object.keys(files)) {
    if (!/\.html$/i.test(rel)) continue;
    let html = files[rel].toString("utf8");
    if (html.includes("data-wss-prehydration-layout") || !/<div\s+id=["']root["']\s*><\/div>/i.test(html)) continue;
    // THE STATIC-HEADLINE GUARD (final-qa Class A, 2026-09). The reserve
    // exists for pages whose FIRST PAINT is otherwise blank — app-only
    // donors whose entire visible page renders into #root on the client.
    // A page whose static bytes already carry the hero <h1> is not such a
    // page: stamping a 100vh skeleton around its mount would inflate the
    // hero into an empty slab (plumbing-clean: hero 1411px desktop /
    // 1837px mobile with the headline pushed below the fold) AND leave
    // #root non-empty, which quietly disarms injectHeroPrerender's
    // empty-root match downstream. Skip those pages untouched.
    if (/<h1[\s>]/i.test(html)) { skippedStaticH1 += 1; continue; }
    if (/<\/head>/i.test(html) && !html.includes('id="wss-prehydration-layout-css"')) {
      html = html.replace(/<\/head>/i, `${css}\n</head>`);
    }
    html = html.replace(/<div\s+id=(["'])root\1\s*><\/div>/i, `<div id="root">${shell}</div>`);
    files[rel] = Buffer.from(html, "utf8");
    pages += 1;
  }
  return { applied: pages > 0, pages, skippedStaticH1 };
}

function buildTokenValues({ facts, phoneDigits, hero, logoPath, slug, pride = null, copy = null }) {
  const previewUrl = `https://${deployLib.aliasHostFor(slug)}/`;
  const previewHost = deployLib.aliasHostFor(slug);
  const geo = facts.latitude != null ? `${displayCoord(facts.latitude)},${displayCoord(facts.longitude)}` : "";
  // THE HEADLINE IS COMPOSED ONCE, HERE, and every surface reads the same
  // object: the single-slot donors take HERO_HEADLINE, the three-line donors
  // take the pieces. Composed rather than templated so the client's own atoms
  // (their motto, their name, their verified rating) are what differ between
  // two mirrors — see lib/mirror-engine/identity-copy.js for the incident.
  const identity = copy || identityCopyFor(facts, { hero, pride });
  const headline = identity.headline;
  return {
    BUSINESS_NAME: facts.business_name,
    PHONE: displayPhone(facts.phone),
    PHONE_DIGITS: phoneDigits,
    // MARKET vs MAILING ADDRESS — two fields, two sources, never conflated.
    // CITY is what the business sells to (their own site's assertion, else the
    // NAP locality); ADDRESS_CITY is the locality of the verified address and is
    // the only value a PostalAddress or a visible address line may use.
    CITY: marketCity(facts),
    ADDRESS_CITY: addressCity(facts),
    STATE: facts.state,
    REGION: facts.state,
    HERO_HEADLINE: headline,
    OWNER_NAME: facts.owner_name || "",
    EMAIL: facts.email || "",
    ADDRESS: facts.address || "",
    COUNTY: facts.county || "",
    ZIP: facts.postal_code || "",
    POSTAL: facts.postal_code || "",
    GEO: geo,
    GEO_LAT: facts.latitude != null ? displayCoord(facts.latitude) : "",
    GEO_LNG: facts.longitude != null ? displayCoord(facts.longitude) : "",
    PLACE_ID: facts.place_id || "",
    RATING: facts.rating != null ? String(facts.rating) : "",
    REVIEW_COUNT: facts.review_count != null ? String(facts.review_count) : "",
    REVIEW_TEXT: "",   // TRUTH LAW: no verified review payload channel in v1 -> blank collapses
    REVIEW_AUTHOR: "", // never a name we cannot verify
    LICENSE: facts.license || "",
    PROFILE_URL: facts.profile_url || "",
    LOGO_URL: logoPath,
    DOMAIN: previewHost,
    PREVIEW_URL: previewUrl,
    PREVIEW_DOMAIN: previewHost,
    SITE_URL: previewUrl,
    HERO_LINE_A: identity.lines.a,
    HERO_LINE_B: identity.lines.b,
    HERO_LINE_C: identity.lines.c,
    HERO_ACCENT: (hero && hero.accent) || "",
    HERO_BADGE: (hero && hero.badge) || "",
  };
}

/**
 * mirror(rawRequest, { dryRun, registry, deps, operationKey, signal, deadlineAt })
 *   -> { ok, status, body }
 * `deps` lets tests stub the deploy/render seams; production uses deployLib.
 */
async function mirror(rawRequest, {
  dryRun = false,
  registry = defaultRegistry,
  deps = {},
  operationKey = "",
  signal,
  deadlineAt = 0,
  internalSamenessRetry = null,
} = {}) {
  const d = { ...deployLib, renderCheck, renderAudit, ...deps };
  const limits = { signal, deadlineAt };
  // GHOST_AGENCY_LIGHT_VERIFICATION — read per call, default LIGHT ON. "0"
  // keeps this engine byte-for-byte on the old full law. Light mode skips the
  // two post-deploy browser passes below (steps 15 and 15b) and records the
  // mode on the manifest so a light build is auditable later.
  const verification = verificationMode(process.env);
  const interrupted = () => Boolean(
    (signal && signal.aborted)
    || (Number.isFinite(Number(deadlineAt)) && Number(deadlineAt) > 0
      && deployLib.remainingBudget(deadlineAt) <= 0)
  );
  const interruption = () => err(504, "mirror_deadline", [{ reason: "caller_abort_or_checkpoint_reserve" }]);
  if (interrupted()) return interruption();

  // 1. Structural validation — strict Ajv, no coercion.
  const structural = checkMirrorRequest(rawRequest);
  if (!structural.ok) return { ok: false, status: structural.status, body: structural.body };
  // Release evidence is the authorization boundary for every successful
  // Mirror build. Refuse a valid request before brand/media providers, shared
  // publishing or Vercel can spend anything when production cannot sign that
  // evidence. The only fallback remains evidence-signature.js's explicit
  // non-production node:test fixture.
  if (!evidenceHmacConfigured(process.env)) {
    return err(503, "mirror_release_evidence_hmac_key_unconfigured", [{
      reason: `${EVIDENCE_HMAC_KEY_ENV}_required`,
      required_env: EVIDENCE_HMAC_KEY_ENV,
    }]);
  }
  let request = structural.request;
  if (internalSamenessRetry != null) {
    const retryOf = String(internalSamenessRetry.retryOf || "").trim();
    const claimId = String(internalSamenessRetry.claimId || "").trim();
    if (
      internalSamenessRetry.attempt !== 2
      || internalSamenessRetry.retryReason !== "sameness_collision"
      || !retryOf
      || !claimId
    ) {
      return err(500, "invalid_internal_sameness_retry", [{ reason: "claimed_attempt_2_metadata_required" }]);
    }
    // Attempt 2 is not part of the public MirrorRequest schema. Only the lane
    // that won the durable retry claim can pass this trusted engine option.
    request = {
      ...request,
      hero: {
        ...(request.hero || {}),
        attempt: 2,
        retryOf: retryOf.slice(0, 240),
        retryReason: "sameness_collision",
      },
    };
  }
  const slug = request.slug;

  // 2. Semantic facts boundary.
  const factsOut = validateFacts(request);
  if (!factsOut.ok) return err(422, factsOut.error, factsOut.detail);
  const { facts, phoneDigits } = factsOut;
  // One publishable content object feeds the hash, the home-page injection,
  // local-search plan and every authority route. Direct engine callers must
  // pass the same service-name truth door as the builder; otherwise a legacy
  // tel:/mailto: nav label can become a signed public service page.
  const publishContent = contentInject.withUsableServices(request.content || {}, facts.business_name);

  // 3. Slug policy. Reserved labels always; the wss-test-* namespace gate only
  //    when this call will actually deploy/alias.
  if (deployLib.RESERVED_SLUGS.has(slug) || slug.startsWith("_")) {
    return err(422, "invalid_facts", [{ path: "/slug", reason: "reserved_slug" }]);
  }
  if (!dryRun) {
    const policy = d.slugPolicy(slug);
    if (!policy.ok) return err(422, "invalid_facts", [{ path: "/slug", reason: policy.reason }]);
  }

  // 3b. GATE 4C — CLIENT ISOLATION PRECONDITION. Before any mutable operation,
  //     the slug's namespaced stamp must AGREE with the identity this request
  //     carries. First build for a slug stamps it (and is still checked for
  //     slug/name coherence, which is what catches a packet labelled with the
  //     wrong client); every later build must agree on name, phone and domain.
  //     Root incident: a "Ramon" packet that actually held Music City Roofers
  //     data passed every downstream gate because nothing checked WHOSE data
  //     it was. There is no flag that turns this off.
  try {
    clientIsolation.guardBuildStart({ slug, facts: { ...facts, business_name: facts.business_name || facts.name }, truthSource: publishContent.truth_source });
  } catch (e) {
    if (e && e.code === "client_isolation_violation") {
      // "Same slug, different business" already has a published contract (409
      // slug_conflict, step 7). Gate 4C makes that check DURABLE — a stamp on
      // disk instead of an in-memory registry that dies with the process — so
      // it must answer with the SAME error a caller already handles.
      const bound = e.failures.find((f) => f.check === "stamp_agreement" && f.field === "businessName");
      if (bound) return err(409, "slug_conflict", [{ slug, bound_to: bound.boundTo, durable: true }]);
      return err(422, "client_isolation_violation", e.failures.map((f) => ({ path: "/facts", reason: `${f.check}: ${f.reason}` })));
    }
    throw e;
  }

  // 4. Donor.
  const donorOut = resolveDonor({ donor: request.donor, industry: facts.industry });
  if (!donorOut.ok) return err(404, donorOut.error, donorOut.detail);
  const { files: donorFiles, contentHash: donorHash } = loadDonor(donorOut.dir);

  // 5. Brand assets (content-addressed; denylist before any fetch).
  const resolveBrand = deps.resolveBrandAssets || resolveBrandAssets;
  // ffmpeg is not in the Vercel lambda (lib/full-run.js documents the same
  // fact for the hero reel), so the transcode seam is injectable for the same
  // reason every other environment-dependent dep is: the tests must be able
  // to state "no transcoder" and still demand placement.
  const transcode = deps.transcodePhoto || transcodePhoto;
  const brandOut = await resolveBrand(request.brand || {});
  if (!brandOut.ok) return err(422, brandOut.error, brandOut.detail);

  // 5c. BRAND_IDENTITY — the extraction lane's direct verdict, RENDER side.
  //
  // lib/brand-extractor.js measures a client's brand from ANY website and
  // ships { accent_color, secondary_color?, background?, logo_url?,
  // font_family?, extraction_method, confidence }. When the verdict carries
  // HIGH or MEDIUM confidence it OVERRIDES the donor template's defaults: the
  // accent flows into the theme sheet appended AFTER the donor's stylesheet
  // (:root { --accent: <client-color>; ... }), so the donor's LAYOUT stands
  // and only the COLOURS change — no donor yellow when the client is red, no
  // donor navy when the client is light. LOW confidence is refused here and
  // the build takes the neutral path (donor defaults, logo measurement,
  // vertical research) exactly as if the field had never been supplied; the
  // refusal reason is carried into the theme report either way.
  const brandIdentity = theme.normalizeBrandIdentity(request.brand_identity || null);
  // 5c-bis. SITE_PALETTE — the WHOLE-WEBSITE reading (owner directive
  // 2026-09-03: "we want to take THEIR SITE colors not just their LOGO
  // colors"). lib/mirror-engine/site-palette.js measures the prospect's own
  // homepage — the surfaces, the ink, the accent the page itself spends, and
  // whether the original paints dark bands — off the HTML stage
  // 2_homepage_fetch already fetched, and the miner carries the verdict here.
  // In buildPalette it is the PRIMARY source: where the site and the logo
  // disagree, the SITE wins the surfaces and the ink; the logo may still win
  // the accent when the site's own is absent or too weak. A refused shape
  // (absent, colourless) is absence, never a build gate — the palette falls
  // through logo → donor token → vertical research exactly as before.
  const sitePalette = theme.normalizeSitePalette(request.site_palette || null);
  // Verified logo BYTES (fetched, magic-byte-sniffed, sha256-pinned) still
  // outrank a hot-linked extraction URL; brand_identity.logo_url fills the
  // header only when no bytes were supplied. The wordmark fallback is last.
  const brandIdentityLogoUrl = brandIdentity.applied ? brandIdentity.logoUrl : "";
  const logoPath = brandOut.logo ? `/assets/client-logo.${brandOut.logo.ext}`
    : (brandIdentityLogoUrl || "/assets/brand-logo.svg");
  // The brand_identity header mark needs its own containment CSS (the donor's
  // logo slot is a round avatar that would crop a wide mark to salad), built
  // from the URL host and appended to every stylesheet below.
  const brandIdentityLogoCss = brandIdentityLogoUrl ? theme.brandIdentityLogoCss(brandIdentityLogoUrl) : "";

  // MIRROR_REQUIRE_BRAND still rejects a request with neither a verified logo
  // nor a recorded ladder mark. The 2026-08-20 logo-ladder decree changes the
  // accepted fallback, not the truth law: a supplied logo still needs its
  // measured accent, while true logo absence may carry an intentional mark.
  const requireBrand = String(process.env.MIRROR_REQUIRE_BRAND || "").trim() === "1";
  const brandRequirementMet = brandOut.logo
    ? Boolean(brandOut.accent)
    : Boolean(brandOut.mark);
  if (requireBrand && !brandRequirementMet) {
    return err(422, "brand_required", [{
      path: "/brand",
      reason: "verified_logo_with_measured_accent_or_ladder_mark_required",
      have: { logo: !!brandOut.logo, accent: !!brandOut.accent, mark: !!brandOut.mark },
    }]);
  }

  // 5f. THE CLIENT'S OWN HERO IMAGERY — extracted from their live site at
  //     build time (lib/mirror-engine/hero-media.js). The owner's
  //     hero-authenticity report: "A hero is the highest-impact identity
  //     surface. Prefer a donor-owned, relevant, high-resolution hero" — the
  //     measured defect was a blue/orange concrete contractor with local
  //     project imagery shipping behind a GENERIC Atlanta/construction hero.
  //     The general photo harvest ranks gallery photography first, so the
  //     hero they actually lead with can be missing from the bank entirely;
  //     this pass goes and gets it (header/hero <img>, video poster, hero CSS
  //     background, og:image — verified for ownership, width and loadability,
  //     cross-prospect-guarded). Fail-soft by contract: every miss is a
  //     reason string and the ladder below falls through unchanged.
  const extractHeroMedia = deps.extractHeroMedia || heroMediaLib.extractClientHeroMedia;
  const heroMediaWebsite = String((request.facts && request.facts.current_website) || "").trim();
  let heroMedia = {
    ok: false, reason: "no_current_website",
    hero: null, og: null, video: null, poster: null,
    rejected: [], candidates: 0,
  };
  if (/^https:\/\//i.test(heroMediaWebsite) && String(process.env.MIRROR_HERO_MEDIA || "").trim() !== "0") {
    try {
      const extractedHeroMedia = await extractHeroMedia({
        website: heroMediaWebsite,
        fetchImpl: deps.fetchHeroMedia || fetch,
        mediaMode: brandOut.mediaMode || "housed",
        registry: heroMediaLib.defaultHeroOwnershipRegistry,
      });
      if (extractedHeroMedia && typeof extractedHeroMedia === "object") heroMedia = extractedHeroMedia;
    } catch (e) {
      heroMedia = {
        ok: false, reason: `extraction_failed:${String(e.message || e).slice(0, 60)}`,
        hero: null, og: null, video: null, poster: null,
        rejected: [], candidates: 0,
      };
    }
  }
  // A verified hero/og/video changes the bytes the customer receives, so it
  // MUST move the build hash — a memo must never replay the pre-hero build
  // (or, via the cross-prospect guard, another prospect's hero) as
  // "identical". Only added when something verified, so every build without
  // client hero media hashes exactly as it did before this pass existed.
  const heroMediaIdentityValue = heroMediaLib.heroMediaIdentity(heroMedia);
  if (heroMediaIdentityValue) {
    brandOut.hashes.hero_media_sha = createHash("sha256")
      .update(JSON.stringify(heroMediaIdentityValue))
      .digest("hex");
  }

  // 5d. THE CUSTOMER'S OWN EDITS — read BEFORE the hash, replayed before the
  //     scans. See lib/site-edit-log.js for the measured failure: this engine
  //     composes a fresh tree from donor + facts + content and then archives it
  //     over wss-site-sources/<slug>/, so until now every rebuild erased every
  //     edit the customer had ever made — from the live site and from the
  //     archive in the same pass, with nothing anywhere recording the loss.
  //
  //     The fingerprint participates in the build hash because an edit CHANGES
  //     THE BYTES: without it, "same donor, same facts, one new voice edit"
  //     hashes identically to the pre-edit build, hits the memo, and returns a
  //     manifest for a site that no longer exists.
  const readEditLog = deps.siteEditLog || siteEditLog;
  const editLog = await readEditLog({ siteSlug: slug });
  if (!editLog.ok) {
    // A FAILED READ IS NOT AN EMPTY LOG. Rebuilding on the assumption that a
    // site nobody could ask about has no edits is precisely how the edits got
    // deleted in the first place, so the build stops here instead.
    return err(503, "site_edit_log_unreadable", [{
      slug,
      reason: String(editLog.reason || "unknown"),
      detail: "refusing to rebuild without knowing what the customer has changed",
    }]);
  }

  // 5e. THE WORDS THAT SAY WHOSE SITE THIS IS. Composed once, before the hash,
  //     because the headline is part of the bytes the customer receives: two
  //     builds that differ only in what the hero says are different builds, and
  //     hashing without it would replay a manifest for a page that no longer
  //     exists. See lib/mirror-engine/identity-copy.js.
  // The pride block is the SECOND door to the hero, and until now it was
  // bricked up. identityCopyFor has accepted `pride` since the day it was
  // written — their proven motto for line A, their heritage for line C — and
  // nothing ever passed it, so the only motto that could reach a page was one
  // the lane had already unpacked into `hero.tagline` by hand. Reading it here
  // means the engine honours a pride block whoever built the request.
  const pride = publishContent.pride || null;
  const copy = identityCopyFor(facts, { hero: request.hero || null, pride });
  if (!copy.lines.a || !copy.lines.b) {
    // Cannot happen with a validated request — BUSINESS_NAME, CITY and STATE
    // are REQUIRED facts — which is exactly why it is asserted rather than
    // assumed: an empty h1 is a blank hero, and a blank hero ships silently.
    return err(422, "missing_required_facts", [
      { token: "HERO_LINE_A", value: copy.lines.a },
      { token: "HERO_LINE_B", value: copy.lines.b },
    ]);
  }

  // 5f. TEMPLATE DIVERSIFICATION — the component-variant selection.
  //
  // Owner directive (2026-09-02 video report): "Atlanta and Jeff Sullivan WSS
  // renders share a very similar hero composition, header, typography scale,
  // red CTA treatment, section rhythm and light-page component system. Add a
  // similarity budget so donor-independent sites cannot converge too
  // strongly." Two unrelated prospects built from the same donor used to
  // receive the donor's exact layout; the selection made here — hero
  // composition, CTA treatment, typography scale, section order and the
  // section-level variants — is deterministic per prospect (seeded by the
  // prospect identity + donor), pinned where the donor fingerprint speaks,
  // and budget-checked against every prior same-donor selection so at least 2
  // of the four axes differ. Computed BEFORE the hash because the selection
  // changes the bytes the customer receives. See
  // lib/mirror-engine/component-variants.js.
  const donorFingerprint = componentVariants.normalizeFingerprint(request.donor_fingerprint || null);
  const variantCues = componentVariants.deriveCues({
    fingerprint: donorFingerprint,
    clientSurface: request.client_surface || null,
    brandIdentityBackground: brandIdentity.applied ? brandIdentity.background : "",
    brandFont: brandIdentity.applied ? brandIdentity.fontFamily : "",
    heroVideo: Boolean(request.brand && request.brand.hero_video && request.brand.hero_video.url),
    photoCount: (brandOut.photos || []).filter((p) => p && p.ok).length,
  });
  const variantBaseSelection = componentVariants.selectVariants({
    prospectId: slug,
    donor: donorOut.name,
    cues: variantCues,
  });
  const variantSelection = componentVariants.enforceSimilarityBudget({
    selection: variantBaseSelection,
    priors: typeof registry.variantRows === "function" ? registry.variantRows(donorOut.name) : [],
    prospectId: slug,
  });

  // 6. Canonical build hash + memo.
  const hash = buildHash({
    donor: donorOut.name,
    donorHash,
    facts,
    phoneDigits,
    brandHashes: brandOut.hashes,
    hero: { ...(request.hero || {}), composed: copy.lines },
    content: publishContent,
    signup: request.signup || null,
    edits: editLog.fingerprint || "",
    variants: componentVariants.selectionSignature(variantSelection),
    // brand_identity changes the bytes the customer receives (palette, logo,
    // display font), so an applied verdict MUST move the hash: without it a
    // re-mirror that adds or changes a brand_identity verdict could hit the
    // memo and replay the pre-override build. Only an APPLIED verdict hashes —
    // a refused one renders identically to its absence, so those requests stay
    // byte-identical, memo included.
    brandIdentity: brandIdentity.applied ? brandIdentity : null,
    // site_palette changes the bytes the customer receives (surfaces, ink,
    // slab rhythm, possibly the accent), so an APPLIED verdict MUST move the
    // hash exactly like brand_identity: without it a re-mirror that adds or
    // changes the site palette could hit the memo and replay the pre-palette
    // build. A refused one renders identically to its absence and stays
    // byte-identical, memo included.
    sitePalette: sitePalette.applied ? sitePalette : null,
  });
  const memoized = registry.memoGet(hash);
  if (memoized && !dryRun) {
    if (interrupted()) return interruption();
    // A memo hit is trusted only as an immutable copy of evidence this engine
    // previously signed. Re-signing corrupted cache contents would launder a
    // mutation into apparently valid release evidence.
    let memoSignatureValid = false;
    try {
      memoSignatureValid = typeof memoized === "object"
        && !Array.isArray(memoized)
        && typeof memoized.evidence_sha === "string"
        && signEvidence(memoized) === memoized.evidence_sha;
    } catch {
      memoSignatureValid = false;
    }
    if (!memoSignatureValid) {
      return err(500, "memo_evidence_invalid", [{
        reason: "cached_release_evidence_signature_invalid",
        build_hash: hash,
      }]);
    }
    // `idempotent_replay` is part of the release evidence returned to callers.
    // Adding it after the cached manifest was signed made every warm-instance
    // replay fail the downstream evidence check. Sign a fresh replay copy and
    // leave the canonical cached manifest byte-for-byte unchanged.
    const replay = { ...memoized, idempotent_replay: true };
    replay.evidence_sha = signEvidence(replay);
    return { ok: true, status: 200, body: replay };
  }

  // 7. Per-slug lock around claim + build + deploy.
  return registry.withSlugLock(slug, async () => {
    const claim = registry.claimSlug(slug, facts.business_name);
    if (!claim.ok) return err(409, "slug_conflict", [{ slug, bound_to: claim.owner }]);

    // 8. Hydrate.
    const tokenValues = buildTokenValues({ facts, phoneDigits, hero: request.hero, logoPath, slug, copy });
    const hydrated = hydrate({ donorFiles, tokenValues });
    if (!hydrated.ok) {
      const status = hydrated.error === "missing_required_facts" ? 422
        : hydrated.error === "unmapped_token" ? 422 : 500;
      return err(status, hydrated.error, hydrated.detail);
    }
    const files = hydrated.files;
    const preHydrationLayout = reservePreHydrationLayout(files);

    // 8b. TEMPLATE DIVERSIFICATION, DOM half — the donor's section order and
    // the scoping attributes. When the donor fingerprint carries
    // section_order, the plain-HTML sections are reordered into that
    // meaningful order (reviews before services stays reviews before
    // services) and every mapped section is stamped data-wss-section="<name>"
    // — the hook the section-variant CSS keys on. SPA donors (sections built
    // at runtime by the compiled bundle) keep their DOM; the report says so.
    // Every HTML page also gains the html-level attributes the variant CSS
    // scopes by. Idempotent, and a donor with no sections to move is a no-op.
    const variantDomReport = componentVariants.applyToFiles(files, variantSelection);

    // 9. Brand application: the client's own logo bytes, or their wordmark.
    const wordmarkFill = (donorOut.manifest && donorOut.manifest.wordmarkFill) || "currentColor";
    files["assets/brand-logo.svg"] = Buffer.from(
      brandWordmarkSvg(facts.business_name, { fill: wordmarkFill, accent: wordmarkFill }),
      "utf8",
    );
    if (brandOut.logo) {
      files[`assets/client-logo.${brandOut.logo.ext}`] = brandOut.logo.bytes;
    }
    // Shape of the client's mark, measured from the shipped bytes. Non-square
    // (wide wordmark or tall lockup) earns the contain-fit override appended in
    // the CSS pass below; a square badge keeps the donor's avatar treatment.
    let logoFitCss = [
      "/* wss-logo-identity: the deterministic fallback is a wordmark, never an avatar. */",
      'img[src*="brand-logo"]{width:auto!important;height:auto!important;max-width:min(13rem,45vw)!important;max-height:3.25rem!important;object-fit:contain!important;border-radius:0.375rem!important;border-color:transparent!important}',
    ].join("");
    if (brandOut.logo) {
      const dims = imageDimensions(brandOut.logo.bytes);
      const ratio = dims && dims.height > 0 ? dims.width / dims.height : 1;
      if (dims && (ratio >= 1.4 || ratio <= 0.7)) {
        logoFitCss += [
          "/* wss-logo-fit: measured client mark is non-square (",
          `${dims.width}x${dims.height}); a round object-cover slot would crop it to salad. */`,
          'img[src*="client-logo"]{width:auto!important;height:auto!important;max-width:min(13rem,45vw)!important;max-height:3.25rem!important;',
          "object-fit:contain!important;border-radius:0.375rem!important;border-color:transparent!important}",
        ].join("");
      }
    }
    // THEIR photos into the donor's declared photo_slots (BOILERPLATE.json).
    // Extension must match the slot — Vercel serves content-type by ext — and
    // an unfilled slot keeps the donor's generic imagery, which is always a
    // safe fallback. Never anyone else's picture, never a generated fake.
    //
    // HOTLINK-UNTIL-PAY (docs/standards/hotlink-until-pay.md): in
    // media_mode:"origin" NO bytes are placed. Every candidate was still
    // fetched+sniffed+hashed once by resolveBrandAssets (truth law unchanged);
    // the slot assignment is recorded as a URL map in
    // assets/wss-origin-media.json and the page references the prospect's OWN
    // origin URLs. Unpaid prospects cost us zero media storage; the paid
    // migration (checkout webhook -> re-mirror with media_mode:"housed") swaps
    // the map for bytes on the same slots. Without bytes there is nothing to
    // transcode, so an origin entry requires an exact extension match — a
    // format-mismatched photo simply stays unplaced rather than being
    // mislabeled.
    const originMode = brandOut.mediaMode === "origin";
    const originMediaEntries = [];
    const photoSlots = Array.isArray(donorOut.manifest.photo_slots) ? donorOut.manifest.photo_slots : [];
    // CLIENT-PHOTO PROMINENCE LAW (owner verdict, 2026-09-01, first factory
    // mirrors): "Client images sit too LOW on the page — especially fencing.
    // The client's own photos must appear HIGH (hero region or
    // immediately-after-hero slot), not buried under donor sections." The
    // manifest's photo_slots are in DESIGN order; on the first factory
    // fencing mirror that order buried every client photograph in section
    // five of eight, under two full donor sections of stock imagery. A donor
    // that knows its render order now declares photo_slot_prominence — the
    // same slots, ordered HIGHEST-RENDERING FIRST — and the fill loop below
    // walks THAT order, so the first owned photograph lands in the most
    // prominent slot the donor's structure gives it and donor stock fills
    // every gap from the bottom up. Slots absent from the ranking keep their
    // relative manifest order after the ranked ones; an entry that is not a
    // real slot is ignored (never a silent path swap).
    const prominenceRank = Array.isArray(donorOut.manifest.photo_slot_prominence)
      ? donorOut.manifest.photo_slot_prominence
      : null;
    const slotFillOrder = prominenceRank
      ? [...photoSlots].sort((a, b) => {
        const ra = prominenceRank.indexOf(a);
        const rb = prominenceRank.indexOf(b);
        return (ra === -1 ? prominenceRank.length : ra) - (rb === -1 ? prominenceRank.length : rb);
      })
      : photoSlots;
    const usablePhotos = (brandOut.photos || []).filter((p) => p.ok);
    let photosPlaced = 0;
    let photosTranscoded = 0;
    let photosExtFallback = 0;
    const deadSlots = [];
    // PER-ASSET PLACEMENT ACCOUNTING. The render gate's owned_photos_retained
    // fact blocks a below-floor build unless every photo in the gap carries a
    // real {url, reason} — and until this list existed the engine wrote only
    // counts, so EVERY zero-placement looked identical: "0 per-asset
    // rejection reason(s)". A campaign build died on exactly that (2 owned
    // photos, 0 placed, 0 reasons — no way to tell a wiring gap from a
    // refusal). Every photograph that does not land now says why.
    const photosUnplacedReasons = [];
    const placedPhotoShas = new Set();
    // The hero wash (below) paints one OWNED photograph behind the donor's
    // declared hero selector — for a donor with no photo_slots at all
    // (general-contractor-clean, medspa-luma: their manifests ship no gallery
    // on purpose) it is the one legitimate surface the donor's own structure
    // gives the client's photography. When it applies, that photograph is
    // shipped and seen, and the owned-photo accounting says so.
    let heroWashOwnedSha = null;
    {
      // A slot the compiled donor never REFERENCES is a dead slot: the photo
      // would upload and never render (observed live — 2 of 4 roofing slots
      // are unreferenced). Only referenced slots count, and `placed` must mean
      // "a visitor will see this", not "we wrote a file".
      const referenced = new Set();
      for (const [rel, buf] of Object.entries(files)) {
        if (!/\.(html|js|css)$/i.test(rel)) continue;
        const text = buf.toString("utf8");
        for (const slot of photoSlots) {
          const base = slot.split("/").pop();
          if (base && text.includes(base)) referenced.add(slot);
        }
      }
      // WHY a usable photograph could not land, for the leftovers the slot
      // loop below leaves in the pool. One environment-level reason, attached
      // per asset — the honest sentence for each shape of dead end.
      const liveSlots = photoSlots.filter((slot) => (slot in files) && referenced.has(slot));
      let leftoverReason = "more_photos_than_slots";
      if (!photoSlots.length) leftoverReason = "no_photo_slots_in_donor";
      else if (!liveSlots.length) leftoverReason = "photo_slots_unreferenced_in_donor_output";
      else if (originMode) leftoverReason = "origin_mode_ext_mismatch_no_transcode";

      // The needle swap behind the extension-preserving fallback below — the
      // same proven replace the origin-mode rewriter performs (absolute path
      // first, then the bare form, because the bare needle is a substring of
      // the absolute one). Slot basenames are per-donor content hashes, so a
      // collision with an unrelated path is not a real case.
      const rewriteSlotPath = (fromSlot, toRel) => {
        const abs = `/${fromSlot}`;
        const bare = String(fromSlot);
        const absTo = `/${toRel}`;
        const bareTo = String(toRel);
        let rewrites = 0;
        for (const rel of Object.keys(files)) {
          if (!/\.(html|js|css)$/i.test(rel)) continue;
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
      };

      const pool = [...usablePhotos];
      for (const slot of slotFillOrder) {
        if (!pool.length) break;
        if (!(slot in files)) continue;
        if (!referenced.has(slot)) { deadSlots.push(slot); continue; }
        const slotExt = String(slot.split(".").pop() || "").toLowerCase().replace("jpeg", "jpg");
        if (originMode) {
          // URL-slot path: exact extension match only (nothing to transcode).
          const idx = pool.findIndex((p) => p.ext === slotExt);
          if (idx < 0) continue;
          const photo = pool.splice(idx, 1)[0];
          originMediaEntries.push({
            slot,
            url: photo.originUrl || photo.url,
            sha256: photo.sha256,
            ext: photo.ext,
            mime: photo.mime,
          });
          photosPlaced++;
          placedPhotoShas.add(photo.sha256);
          continue;
        }
        // Prefer an exact-format match, else TRANSCODE. Demanding an exact
        // extension wasted 7 of 8 real photos on a business whose imagery is
        // all .webp against .jpg slots. Vercel serves content-type by
        // extension, so we convert the bytes rather than mislabel them.
        let idx = pool.findIndex((p) => p.ext === slotExt);
        let bytes = null;
        let targetRel = slot;
        if (idx >= 0) {
          bytes = pool[idx].bytes;
        } else if (pool.length) {
          idx = 0;
          bytes = await transcode(pool[0].bytes, pool[0].ext, slotExt);
          if (bytes) photosTranscoded++;
        }
        if (!bytes && pool.length) {
          // …AND WHEN THERE IS NO TRANSCODER, PLACE THE PHOTO ANYWAY — at the
          // slot's own path stem with the photograph's REAL extension, every
          // reference rewritten to it. ffmpeg is not in the Vercel lambda, and
          // a .webp-only client against .jpg-only slots therefore placed ZERO
          // photographs serverless (the campaign kill: usable 2, placed 0).
          // Shipping the true bytes under their true extension mislabels
          // nothing — Vercel serves content-type by extension, so the page is
          // honest — and the donor's own slot file stays in the tree as the
          // documented fallback for any reference form this pass missed.
          idx = 0;
          const photo = pool[0];
          const photoExt = String(photo.ext || "").toLowerCase().replace("jpeg", "jpg") || "jpg";
          const fallbackRel = `${slot.replace(/\.[a-z0-9]+$/i, "")}.${photoExt}`;
          const rewrites = rewriteSlotPath(slot, fallbackRel);
          // Counted as placed only when a reference the page actually loads
          // was rewritten to it — `placed` means "a visitor will see this".
          if (rewrites > 0) {
            bytes = photo.bytes;
            targetRel = fallbackRel;
            photosExtFallback++;
          }
        }
        if (!bytes) continue;
        const photo = pool.splice(idx, 1)[0];
        files[targetRel] = bytes;
        photosPlaced++;
        placedPhotoShas.add(photo.sha256);
      }
      for (const photo of pool) {
        photosUnplacedReasons.push({ url: photo.url, reason: leftoverReason });
      }
    }

    // The client's own hero video — rung 1 of the donor's declared
    // hero_video ladder (manifest.hero_video.client_video_path). Placed only
    // when the sniffed format matches the slot's extension: Vercel serves
    // content-type by extension, and a mislabeled clip is worse than none.
    // Any miss leaves the ladder on its next rung — never a borrowed clip.
    //
    // In origin mode the verified clip is RECORDED in the URL manifest for the
    // paid migration to house later; the ladder stays on its next rung (the
    // WSS-owned fallback clip), exactly as a build with no client video.
    let heroVideoPlaced = 0;
    let heroVideoReason = "";
    const heroVideoSlot = donorOut.manifest && donorOut.manifest.hero_video && donorOut.manifest.hero_video.client_video_path;
    // THE EXTRACTED HERO CLIP — when the caller did not supply
    // brand.hero_video, the 5f extraction may have found the client's own
    // hero video (an mp4/webm source inside their hero/header region). A
    // caller-supplied clip always wins (explicit provenance chain); the
    // extracted one passed the same laws on the way in (domain-bound,
    // magic-byte-sniffed, cross-prospect-guarded) and now flows through the
    // SAME placement gates below — extension must match the slot, origin
    // mode records the URL manifest, never a borrowed clip.
    let heroVideoExtracted = false;
    if (!brandOut.heroVideo && heroMedia.video && heroVideoSlot) {
      brandOut.heroVideo = heroMedia.video;
      heroVideoExtracted = true;
    }
    if (brandOut.heroVideo && heroVideoSlot) {
      if (!brandOut.heroVideo.ok) {
        heroVideoReason = brandOut.heroVideo.reason || "hero_video_unusable";
      } else if (originMode) {
        originMediaEntries.push({
          slot: heroVideoSlot,
          kind: "hero_video",
          url: brandOut.heroVideo.sourceUrl,
          sha256: brandOut.heroVideo.sha256,
          ext: brandOut.heroVideo.ext,
          mime: brandOut.heroVideo.mime,
        });
        heroVideoReason = "origin_mode_url_manifest";
      } else if (String(heroVideoSlot.split(".").pop() || "").toLowerCase() !== brandOut.heroVideo.ext) {
        heroVideoReason = `hero_video_ext_mismatch:${brandOut.heroVideo.ext}`;
      } else {
        files[heroVideoSlot] = brandOut.heroVideo.bytes;
        heroVideoPlaced = 1;
      }
    }
    // finalizeHeroArtifact (the ladder island rewrite + fail-safe net) runs
    // AFTER the hero wash below: the stock-fallback suppression needs the
    // wash verdict — whether the client's own photograph owns this hero.

    // 9a-sexies. THE CLIMATE COPY GUARD
    // (lib/mirror-engine/climate-copy-guard.js, audit A1): the hvac donor's
    // literal "a 118-degree afternoon" headline shipped to Michigan, New
    // Jersey and South Carolina on every build — the donor's <h1> carries
    // no copy token, so nothing downstream could re-own it. The guard runs
    // over the EMITTED pages' hero h1 / title / meta / alt / hero-region
    // text: a climate claim ships only to a region whose climate licenses
    // it; anywhere else it becomes a region-appropriate phrase (or the
    // climate-neutral one), with the swap recorded as copy_slot
    // provenance for the manifest below.
    const climateGuard = applyClimateCopyGuard({ files, facts: request.facts });

    // THE ORIGIN URL MAP — the origin-mode counterpart of byte placement. The
    // rewriter (content-inject) turns every slot reference in the built HTML/JS
    // into the prospect's own verified origin URL, so the manifest and the
    // page must be written together, before any scan reads the tree. The
    // render gate then loads the page in a real browser: an origin URL that
    // 404/403s is a dead asset and fails the build, so a hotlink-protecting
    // host can never ship silently.
    let originMediaReport = null;
    if (originMode && originMediaEntries.length) {
      files["assets/wss-origin-media.json"] = Buffer.from(JSON.stringify({
        schema: "wss-origin-media-v1",
        media_mode: "origin",
        note: "Verified at build time (fetch + magic-byte sniff + sha256). Hotlinked until payment; the checkout webhook re-mirrors with media_mode:housed to house the bytes.",
        entries: originMediaEntries,
      }, null, 2), "utf8");
      const rewritten = contentInject.rewriteOriginMedia({ files });
      for (const [rel, buf] of Object.entries(rewritten.files)) files[rel] = buf;
      originMediaReport = rewritten.report;
    }

    // A3(C) — the hero-tile aspect adaptation (helper above): runs once the
    // photo slots hold their final bytes and the HTML its final srcs, so a
    // landscape client poster stops being cover-cropped into the donors' 4:5
    // portrait .hero-visual tile. Purely additive CSS + attribute truth; a
    // portrait or unmeasurable tile ships exactly as before.
    let heroTileAspect = null;
    try {
      heroTileAspect = applyHeroTileAspect({ files });
    } catch {
      heroTileAspect = { applied: false, landscape: false, pages: 0, img_attrs_fixed: 0, stylesheet: null, photo: null };
    }

    // EFFECTIVE BRAND INPUTS. An applied brand_identity verdict OVERRIDES the
    // logo-measured values in every downstream recolour pass — the donor's
    // own hues must not survive anywhere (compiled-JS oklch literals included)
    // while the override sheet above the fold already wears the client's
    // colours. Without the override the effective values ARE the old ones, so
    // every existing request behaves exactly as before.
    const effAccent = (brandIdentity.applied && brandIdentity.accent) || brandOut.accent || "";
    const effSecondary = (brandIdentity.applied && brandIdentity.secondary) || brandOut.primary || "";
    // DISPLAY FONT. brand_identity.font_family is honoured only when it is
    // deliverable — web-safe or a known Google Font (theme.brandIdentityFont).
    // Anything else keeps the donor's typography; the page never references a
    // face nobody loaded.
    const biFont = brandIdentity.applied ? theme.brandIdentityFont(brandIdentity.fontFamily) : null;
    const effFonts = { ...(brandOut.fonts || {}) };
    if (biFont) effFonts.display = biFont.family;

    if (brandOut.accent || brandOut.primary || brandOut.secondary_accent || brandIdentity.applied || logoFitCss || brandIdentityLogoCss) {
      for (const [rel, buf] of Object.entries(files)) {
        const isCss = /\.css$/i.test(rel);
        // The donor's brand does not live only in its stylesheet. A compiled
        // Tailwind app bakes arbitrary colours into the JS BUNDLE as literals
        // (the plumbing hero's amber glow is `oklch(0.96 0.02 80 / 0.2)` inside
        // a utility class), so a CSS-only remap leaves the donor's own hue
        // washing over a client's site. Literals get hue-swapped in both.
        const isJs = /\.js$/i.test(rel);
        if (!isCss && !isJs) continue;
        let text = buf.toString("utf8");
        let touched = 0;
        // The client's SECOND colour into the donor's declared PAINT ROLE.
        //
        // Runs FIRST, ahead of applyBrandToCss, and the order is load-bearing:
        // a donor's default for this slot is an indirection to its own accent
        // variables (plumbing-clean: `--brand-secondary: var(--accent-glow)`),
        // and the pass reads that default to learn the lightness the role was
        // designed at. applyBrandToCss overwrites --accent-glow with the
        // CLIENT's accent, so running after it would measure the wrong band.
        //
        // Without this the second colour only ever reached the surface
        // variables, where it lands at 96% and 12% lightness and reads as
        // off-white and black — measured on Rimrock Plumbing, whose green
        // was live on the page and invisible.
        // The donor's declared secondary PAINT role takes the client's second
        // colour — OR the logo colour a site-chrome accent decision demoted
        // (brand-assets.js accent_decision). The demoted colour reaches ONLY
        // this slot, never the surface tint: repainting the paper in the hue
        // the owner just refused is the Family Heating defect re-shipped.
        if (isCss && (effSecondary || brandOut.secondary_accent)) {
          const { css, changed } = applySecondaryToCss(text, { secondary: effSecondary || brandOut.secondary_accent });
          text = css; touched += changed;
        }
        if (isCss && effAccent) {
          const { css, changed } = applyBrandToCss(text, { accent: effAccent });
          text = css; touched += changed;
        }
        // The client's SECOND colour: their surfaces, not just their accent.
        if (isCss && effSecondary) {
          const { css, changed } = applySurfaceToCss(text, { primary: effSecondary });
          text = css; touched += changed;
        }
        if (effSecondary) {
          const { text: out, changed } = applyLiteralHues(text, { primary: effSecondary });
          text = out; touched += changed;
        }
        // Their TYPEFACE. Rewriting the donor's font custom-properties swaps
        // headings, body and buttons at once, because every component already
        // reads the variable — no layout rule is touched. A brand_identity
        // display font overrides brand.fonts.display (the extraction lane's
        // verdict is the newer measurement).
        if (isCss && (effFonts.display || effFonts.body)) {
          const { css, changed } = applyFontsToCss(text, { display: effFonts.display || "", body: effFonts.body || "" });
          text = css; touched += changed;
        }
        // READABLE BUTTONS, after every hue pass has spoken. The recolor
        // passes mapped --primary-foreground right along with --primary, and
        // Texas Best Fence & Patio shipped CTAs whose text sat one lightness
        // point from their own fill (31 30% 15% on 32 32% 16%). The foreground
        // of a pair is whatever READS on the base, not a brand hue; pairs that
        // already clear 4.5:1 are left exactly as the donor designed them.
        if (isCss) {
          const { css, changed } = enforcePairedForegroundContrast(text);
          text = css; touched += changed;
        }
        // A WORDMARK IS NOT AN AVATAR. Donors render the client logo in a
        // fixed round slot with object-cover; a 234x88 wordmark cropped into a
        // 48px circle shipped as letter-salad on a live mirror. When the
        // shipped logo is clearly non-square, appended CSS (last rule wins at
        // equal specificity, plus !important against utility classes) switches
        // every client-logo placement to contain-fit with a soft corner. The
        // donor's own square-badge aesthetic is untouched for square logos.
        // A brand_identity logo_url gets the same containment (its own sheet,
        // keyed on the URL host, with an explicit mobile step).
        if (isCss && (logoFitCss || brandIdentityLogoCss)) {
          text = `${text}\n${logoFitCss}${brandIdentityLogoCss}\n`;
          touched += 1;
        }
        if (touched) files[rel] = Buffer.from(text, "utf8");
      }
    }

    // THEIR FACES, LOADED. applyFontsToCss (above) swaps the donor's --font-*
    // custom properties to the client's families; without this link the page
    // asks for "Rubik" and receives the fallback, because nobody ever loaded
    // the webfont. resolveBrandAssets only carries hrefs that already point at
    // fonts.googleapis.com, so the injected link is first-party Google Fonts.
    // A brand_identity Google font gets the same first-party link, built from
    // the allowlisted family (web-safe faces need no download and no link).
    // This sits OUTSIDE the content gate on purpose: a typeface belongs to the
    // canvas, not to the copy — a brand_identity font on a content-less build
    // still has to load. Idempotent: a page that already carries the exact
    // href changes nothing.
    const fontHref = (brandOut.fonts && brandOut.fonts.href)
      || (biFont && biFont.provider === "google" ? theme.googleFontsHref(biFont.family) : "");
    if (fontHref && files["index.html"]) {
      const idxHtml = files["index.html"].toString("utf8");
      const alreadyLoaded = idxHtml.includes(fontHref);
      if (!alreadyLoaded && /<\/head>/i.test(idxHtml)) {
        files["index.html"] = Buffer.from(
          idxHtml.replace(/<\/head>/i, `<link rel="stylesheet" href="${fontHref.replace(/"/g, "&quot;")}">\n</head>`),
          "utf8",
        );
      }
    }

    // 9a-bis. THE THEME. Light by default, in the client's own colours.
    //
    // OWNER, 2026-08-11: "all the sites are still dark background... eighty or
    // ninety percent of the clients we are mirroring have white backgrounds."
    // Measured before changing anything (scripts/measure-fleet-surfaces.js, 45
    // prospects rendered): 40 of 42 client sites have a LIGHT content surface
    // (95.2%); 45 of 45 of our mirrors opened DARK. He was right and the
    // estimate was right.
    //
    // The dark was never `--background` — that token is already 99% lightness
    // and body renders near-white. It came from Tailwind ARBITRARY VALUES baked
    // into the compiled markup (`bg-[hsl(215_65%_8%)]` and three siblings) plus
    // `bg-primary`, whose token is a near-black navy. Those are donor CSS
    // RULES, so an appended override sheet reaches all of them without editing
    // a single donor file — which is why this is an engine change and not a
    // donor change. See lib/mirror-engine/theme.js for the full trace.
    let themeReport = { applied: false, reason: "not_attempted" };
    // The applied palette, kept for the hero wash below: the scrim must be
    // proven against the colours the shipped hero ACTUALLY wears (slab +
    // slabInk after the slab repoint), not against constants sampled from the
    // un-themed donor. null whenever the theme was not applied.
    let themePalette = null;
    {
      const decision = theme.decideMode(request.client_surface || null, {
        donor: donorOut.name,
        vertical: facts.industry || donorOut.manifest?.vertical || "",
        preferCinematicDark: donorOut.name === "plumbing-clean",
        // A brand_identity background is the extraction lane's direct reading
        // of the client's own canvas: light shifts the theme to light (even a
        // cinematic-dark donor yields), dark keeps dark. Absent, the evidence
        // chain below decides exactly as before.
        brandIdentityBackground: brandIdentity.applied ? brandIdentity.background : "",
        // THE SITE PALETTE'S CANVAS decides on the same terms when the
        // confidence-gated verdict shipped no background of its own — the
        // whole-site directive: a genuinely dark-navy original keeps a dark
        // mirror, a warm-cream original stays light, whatever the logo says.
        sitePaletteBackground: sitePalette.applied ? sitePalette.surface : "",
      });
      // THE PALETTE, WITH THE OVERRIDE SEATED. buildPalette itself re-seats
      // brand_identity's accent/secondary over these inputs when applied, and
      // names the palette source brand_identity_extraction so no report can
      // imply a logo measurement that did not happen. The site palette rides
      // the same door as the owner's primary chain — site → logo → donor
      // token → vertical research — and the report says which source won.
      //
      // THE DONOR FAMILY'S OWN ACCENT is the fallback ahead of vertical
      // research when the client has none (2026-09-02 smoke: a no-palette
      // roofing client shipped generic blue because nothing fed the theme the
      // brick --wss-accent its own donor stylesheet declares). Seeded from the
      // shipped CSS bytes, gated by the same saturation floor inside
      // buildPalette, and never outranking a client colour.
      const donorAccentSeed = (() => {
        for (const rel of Object.keys(files).filter((r) => /\.css$/i.test(r)).sort()) {
          const m = files[rel].toString("utf8").match(/--wss-accent\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i);
          if (m) return m[1];
        }
        return "";
      })();
      const palette = theme.buildThemePair({
        accent: brandOut.accent || "",
        primary: brandOut.primary || "",
        gradient: brandOut.accent_gradient || null,
        vertical: facts.industry || donorOut.manifest?.vertical || "",
        mode: decision.mode,
        brandIdentity: brandIdentity.applied ? brandIdentity : null,
        donorAccent: donorAccentSeed,
        sitePalette: sitePalette.applied ? sitePalette : null,
      });

      // A palette that cannot clear 4.5:1 is not shipped. Falling back to the
      // donor's own theme is a worse-looking page; shipping unreadable body
      // copy is a broken one, and only one of those is recoverable by a human
      // looking at it.
      // THE ACCENT FLOOR IS UNCONDITIONAL (2026-09-03 micro-fix, live-probed
      // on wss-test-kangaroof-round-rock). The full sheet below is
      // deliberately conditional — a palette that cannot clear contrast is
      // refused — but the polish layers (mobile CTA visibility) and the
      // injected islands consume --wss-accent/--wss-accent-hsl on EVERY
      // build, and a page that defines neither lets those consumers fall to
      // hardcoded blue literals. Both skip paths now ship the accent
      // bootstrap: hex + triplet + ink, from the same seeded palette, so no
      // consumer anywhere falls to a blue literal.
      const accentBoot = theme.accentBootstrapCss({ palette });
      const inlineAccentBootstrap = () => {
        const idx = files["index.html"] ? files["index.html"].toString("utf8") : "";
        if (!idx || !accentBoot || !/<\/head>/i.test(idx)) return false;
        files["index.html"] = Buffer.from(
          idx.replace(/<\/head>/i, `<style data-wss-accent>\n${accentBoot}\n</style>\n</head>`),
          "utf8",
        );
        return true;
      };
      if (!palette.passes) {
        const cssRels = Object.keys(files).filter((r) => /\.css$/i.test(r)).sort();
        const target = cssRels[cssRels.length - 1];
        let accentSeeded = false;
        if (target) {
          files[target] = Buffer.concat([
            files[target],
            Buffer.from(`\n${accentBoot}\n`, "utf8"),
          ]);
          accentSeeded = true;
        } else {
          accentSeeded = inlineAccentBootstrap();
        }
        themeReport = {
          applied: false,
          reason: `contrast_failed:${palette.contrastFailures.join(",")}`,
          contrast: palette.contrast,
          accent_seeded: accentSeeded,
        };
      } else {
        // Appended to the LAST stylesheet, so our rules win on source order at
        // equal specificity while every donor rule stays byte-identical.
        const cssRels = Object.keys(files).filter((r) => /\.css$/i.test(r)).sort();
        const target = cssRels[cssRels.length - 1];
        if (!target) {
          // No stylesheet to append the full sheet to — the accent bootstrap
          // goes inline, so the accent pair is still defined on this build.
          const accentInline = inlineAccentBootstrap();
          themeReport = { applied: false, reason: "donor_ships_no_stylesheet_to_append_to", accent_inline: accentInline };
        } else {
          const donorCss = files[target].toString("utf8");
          const sheet = theme.themeCss({ palette, donorCss, defaultMode: decision.mode });
          // READABLE BUTTONS, decided against the FINAL primary. The theme's
          // :root override serves two masters with one token: --primary is the
          // page's TEXT ink (wordmark, nav) and --primary-foreground the slab
          // ink — correct for both — but shadcn buttons also use --primary as
          // their FILL with --primary-foreground as their label. On a client
          // with a dark brand that shipped dark-on-dark CTAs (Texas Best,
          // 2026-08-20, measured: fill 31 30% 15%, label 32 32% 16%). Clamping
          // the VARIABLE would break slab text the other way, so the fix is a
          // rule scoped to actual primary-filled surfaces, its ink picked by
          // WCAG contrast against the sheet's own final --primary value.
          const btnRule = buttonInkRuleForSheet(sheet, decision.mode);
          files[target] = Buffer.from(`${donorCss}\n${sheet}${btnRule ? `\n${btnRule}` : ""}`, "utf8");

          // THE LOGO PLATE LAW (owner verdict, 2026-09-01): on a DARK default
          // canvas a raster client logo (no transparency guarantee) gets a
          // light pill, so ANY logo reads clean on dark. SVG marks carry their
          // own transparency and currentColor and are excluded; the rules are
          // scoped to the explicit dark state, so light-default donors and
          // light toggles are untouched. See fleet-polish.logoPlateCss.
          let logoPlateApplied = false;
          const darkHeaderLogo = needsDarkHeaderLogoContrast({
            donor: donorOut.name,
            vertical: facts.industry || donorOut.manifest?.vertical || "",
          });
          const logoExt = String(brandOut.logo && brandOut.logo.ext || "").toLowerCase();
          if ((decision.mode === "dark" || darkHeaderLogo) && brandOut.logo
            && logoExt !== "svg") {
            files[target] = Buffer.concat([
              files[target],
              Buffer.from(`\n${fleetPolish.logoPlateCss({ includeHeader: darkHeaderLogo })}\n`, "utf8"),
            ]);
            logoPlateApplied = true;
          } else if ((decision.mode === "dark" || darkHeaderLogo) && brandOut.logo && logoExt === "svg") {
            files[target] = Buffer.concat([
              files[target],
              Buffer.from(`\n${fleetPolish.lightLogoFallbackCss({ includeHeader: darkHeaderLogo })}\n`, "utf8"),
            ]);
          }

          // THE HERO CONTRAST FLOOR (owner verdict, 2026-09-01: "hero text is
          // washed out"). A donor whose photographic hero the wash does NOT
          // own declares hero_floor: {selector} in its manifest and gets a
          // proven veil + solid sub-line ink here — the same worst-case
          // mathematics the hero wash uses (lib/hero-wash.js scrimAlphaFor),
          // applied to the donor's own hero instead of a client wash. Donors
          // whose cinematic stack owns its pixels (plumbing-clean) opt out by
          // declaring nothing, exactly as they do for hero_wash.
          let heroFloor = { applied: false, reason: donorOut.manifest?.hero_floor ? "floor_not_built" : "donor_declares_no_hero_floor" };
          const heroFloorSpec = donorOut.manifest && donorOut.manifest.hero_floor;
          if (heroFloorSpec && heroFloorSpec.selector) {
            // Dark veil: the cinematic anchor, proven for the dimmest ink.
            const darkProof = scrimAlphaFor({ scrimHex: "#0b1220", textHex: HERO_SUB_INK, target: 4.5 });
            const darkAlpha = darkProof.ok && Number.isFinite(darkProof.alpha) ? darkProof.alpha : 0.85;
            // Light veil: the LIGHT counterpart palette's own surface, proven
            // for that palette's text ink — the exact pair a visitor gets when
            // the toggle flips the hero to light.
            const lightTheme = palette.mode === "light" ? palette : palette.counterpart;
            const lightBase = parseHexColor(lightTheme && lightTheme.surface) || { r: 247, g: 244, b: 238 };
            const lightHex = `#${[lightBase.r, lightBase.g, lightBase.b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
            const lightProof = scrimAlphaFor({ scrimHex: lightHex, textHex: (lightTheme && lightTheme.text) || "#1a1a1a", target: 4.5 });
            const lightAlpha = lightProof.ok && Number.isFinite(lightProof.alpha) ? lightProof.alpha : 0.85;
            const floorCss = fleetPolish.heroContrastFloorCss({
              selector: heroFloorSpec.selector,
              darkScrim: `rgba(11, 18, 32, ${darkAlpha})`,
              lightScrim: `rgba(${lightBase.r}, ${lightBase.g}, ${lightBase.b}, ${lightAlpha})`,
            });
            if (floorCss) {
              files[target] = Buffer.concat([
                files[target],
                Buffer.from(`\n${floorCss}\n`, "utf8"),
              ]);
              heroFloor = {
                applied: true,
                selector: heroFloorSpec.selector,
                dark_alpha: darkAlpha,
                light_alpha: lightAlpha,
                dark_worst_case: darkProof.worstCaseRatio || null,
                light_worst_case: lightProof.worstCaseRatio || null,
              };
            } else {
              heroFloor = { applied: false, reason: "empty_selector_after_trim" };
            }
          }

          const slabs = theme.darkSurfaceSelectors(donorCss);
          const auroras = theme.auroraSelectors(donorCss);

          // The toggle and its pre-paint boot script, into every HTML page.
          // The control goes before </body> — OUTSIDE the React root, for the
          // same reason the signup floater does: a compiled SPA owns everything
          // inside #root and discards anything it did not render there.
          let pages = 0;
          for (const rel of Object.keys(files)) {
            if (!/\.html$/i.test(rel)) continue;
            let html = files[rel].toString("utf8");
            if (html.includes("data-wss-theme-toggle")) continue;
            if (/<\/head>/i.test(html)) {
              html = html.replace(/<\/head>/i, `${theme.themeBootScript(decision.mode)}\n</head>`);
            }
            if (/<\/body>/i.test(html)) {
              html = html.replace(/<\/body>/i, `${theme.themeToggleHtml(decision.mode)}\n</body>`);
              pages += 1;
            }
            files[rel] = Buffer.from(html, "utf8");
          }

          themePalette = palette;
          themeReport = {
            applied: true,
            mode: decision.mode,
            mode_why: decision.why,
            mode_measured: decision.measured,
            palette_source: palette.source,
            fallback_palette: palette.fallbackName,
            surface: palette.surface,
            slab: palette.slab,
            accent: palette.accent,
            text: palette.text,
            contrast: palette.contrast,
            dark_slabs_repointed: slabs.arbitrary.length + slabs.tokens.length,
            motion_layers_recoloured: auroras.length,
            stylesheet: target,
            toggle_pages: pages,
            logo_plate: logoPlateApplied,
            hero_floor: heroFloor,
          };
        }
      }
    }

    // BRAND_IDENTITY AUDIT TRAIL, on every theme branch. The report must
    // always say whose measurement dressed the page — the extraction lane's
    // verdict and how it was produced, or exactly why it was refused — and
    // saying it in one place is the only way the "theme not applied" branches
    // (contrast failure, donor without a stylesheet) cannot silently drop it.
    themeReport.brand_identity = {
      applied: brandIdentity.applied,
      reason: brandIdentity.reason,
      ...(brandIdentity.applied ? {
        confidence: brandIdentity.confidence,
        extraction_method: brandIdentity.extractionMethod,
        accent: brandIdentity.accent,
        secondary: brandIdentity.secondary || null,
        background: brandIdentity.background || null,
        logo_url: brandIdentityLogoUrl || null,
        font: biFont ? `${biFont.family} (${biFont.provider})` : null,
      } : {}),
    };

    // SITE_PALETTE AUDIT TRAIL, on every theme branch, beside the
    // brand_identity one: what the whole-website lane measured, whether it
    // dressed the page, and — when the theme applied — which source actually
    // won each role (palette_source says the overall winner; `site` names the
    // role-level split: surfaces/ink from the site, accent from site or
    // logo). One place, so the "theme not applied" branches cannot silently
    // drop it either.
    themeReport.site_palette = {
      applied: sitePalette.applied,
      reason: sitePalette.reason,
      ...(sitePalette.applied ? {
        extraction_method: sitePalette.extractionMethod || "site_html_css",
        surface: sitePalette.surface,
        ink: sitePalette.ink,
        accent: sitePalette.accent,
        mode: sitePalette.mode,
        has_dark_slabs: sitePalette.hasDarkSlabs,
        dark_section_count: sitePalette.darkSectionCount,
      } : {}),
      ...(themePalette ? {
        won: themePalette.source === "site",
        roles: themePalette.site || null,
      } : {}),
    };

    // 9a-bis-2. TEMPLATE DIVERSIFICATION, CSS half — the variant sheet.
    //
    // Appended to the LAST stylesheet AFTER the theme sheet and BEFORE the
    // hero wash, so the ordering is: theme tokens -> variant geometry/typography
    // -> hero-wash proven inks. Wherever the wash and a variant rule both
    // speak (hero colours), the wash wins by source order — its contrast is
    // the proven one. The variant CSS only ever writes colours through the
    // theme's own contrast-proven --wss-* pairs, and when the theme did not
    // apply (withColors:false) it ships shape and geometry only, so no page
    // can lose contrast to diversification. The typography scale rides along
    // here too (theme.js owns the sheet; the variant system owns the choice).
    let variantCssReport = { applied: false, reason: "donor_ships_no_stylesheet_to_append_to" };
    {
      const cssRels = Object.keys(files).filter((r) => /\.css$/i.test(r)).sort();
      const target = cssRels[cssRels.length - 1];
      if (target) {
        const heroSpec = donorOut.manifest && donorOut.manifest.hero_wash;
        const heroSelector = heroSpec && heroSpec.selector ? [heroSpec.selector] : null;
        const css = componentVariants.variantCss(variantSelection, {
          heroSelector,
          withColors: Boolean(themePalette),
        }) + theme.typographyScaleCss(variantSelection.type_scale);
        if (css) {
          files[target] = Buffer.concat([files[target], Buffer.from(`\n${css}`, "utf8")]);
          variantCssReport = {
            applied: true,
            stylesheet: target,
            hero: variantSelection.hero,
            cta: variantSelection.cta,
            type_scale: variantSelection.type_scale,
            section_variants: variantSelection.section_variants,
            colors: Boolean(themePalette),
          };
        } else {
          variantCssReport = { applied: false, reason: "empty_variant_sheet" };
        }
      }
    }

    // 9a-ter. THEIR OWN PHOTOGRAPH BEHIND THE PAGE HERO — after the theme, on
    // purpose, because the scrim's contrast proof is only a proof when it is
    // computed against the colours the shipped hero actually wears.
    //
    // WHY THE SCRIM COMES FROM THE THEME PASS AND NOT FROM THE DONOR MANIFEST.
    // The first wiring of this feature read hero_background / hero_text_color
    // sampled from the RAW donor, and the donors' own manifests now document
    // why that was turned off: engine.js re-themes every hero per client
    // (light by default, in their colours), so a scrim proven against the
    // un-themed donor describes a page that is never shipped — rendered proof
    // was a dark navy headline over a wash whose recorded text colour was
    // #efece7, an illegible hero passing every gate. The theme pass KNOWS the
    // colours the hero ends up in: the slab (every dark hero band is repointed
    // to --wss-slab) and the slab's ink. Those are the scrim anchor and the
    // text the guarantee must hold for. The manifest's sampled colours remain
    // only as the fallback for a build whose theme pass did not apply — the
    // one case where the donor's own hero colours ARE what ships.
    //
    // THE SELECTOR IS STILL THE DONOR'S PROVEN ONE. A selector that matches
    // nothing reports success exactly like one that works, so the wash applies
    // only where a per-donor selector was proven to paint by a before/after
    // pixel diff (BOILERPLATE.json hero_wash.selector + pages_verified).
    //
    // WHICH PHOTOGRAPH: their own CURRENT hero image first — the owner's ask
    // is literally "use his hero picture that he currently has, low opacity" —
    // then an identity-critical portrait (the owner/crew photo the design
    // brief flagged), then the best hero-grade banked photo, then the first
    // usable photo. The bank rows carry the flags (lib/mirror-lane-build maps
    // the design brief onto the bank); every row already passed the ownership
    // gate, so a stock picture structurally cannot be flagged.
    let heroWash = { applied: false, reason: "no_photo_bank" };
    // THE HERO-MEDIA LADDER (lib/mirror-engine/hero-media.js) — whose hero
    // this build ships, decided once and reported:
    //   rung 1  the client's own hero image/video, extracted at 5f (or the
    //           bank row the lane already flagged as their CURRENT hero)
    //   rung 2  their verified og:image; then their own banked photography
    //   rung 3  a neutral trade fallback from the WSS asset pool (the donor's
    //           texture/drawn base — never mistakable for project evidence)
    //   rung 4  a brand-accent solid with subtle CSS texture (no photo)
    // NEVER another prospect's hero: every extracted row passed the
    // cross-prospect guard (client-domain bound + sha ownership registry)
    // before it could get here.
    let heroMediaSelection = null;
    let heroMediaGrade = { applied: false, reason: null };
    {
      const spec = donorOut.manifest && donorOut.manifest.hero_wash;
      const bank = request.brand && request.brand.photo_bank;
      const banked = pickHeroPhoto(bank);
      heroMediaSelection = heroMediaLib.selectHeroMedia({
        extracted: heroMedia,
        bankedRow: banked,
        firstUsableRow: usablePhotos[0] || null,
        neutralAsset: heroMediaLib.neutralHeroAsset(files),
      });
      const bankedBytes = banked
        ? (usablePhotos.find((p) => p.sha256 === banked.sha256)
          // Bytes can differ from the banked sha when the client re-exported
          // the same picture; the URL is then the honest join key.
          || usablePhotos.find((p) => banked.url && p.url === banked.url))
        : usablePhotos[0];
      // The extracted rows carry their own verified bytes (or their verified
      // origin URL in origin mode); bank rows join to usablePhotos as before.
      const extractedHeroRow = heroMediaSelection
        && (heroMediaSelection.heroOrigin === "extracted_hero" || heroMediaSelection.heroOrigin === "extracted_og")
        ? heroMediaSelection.hero : null;
      const heroBytes = extractedHeroRow || bankedBytes;
      // ORIGIN MODE holds no photo bytes, but the verified origin URL serves
      // the very photograph the wash wants — so the wash hotlinks it, exactly
      // like every other origin reference on the page. Nothing is guessed:
      // the URL was fetched and hashed at build time.
      const heroSourceUrl = heroBytes ? (heroBytes.originUrl || heroBytes.url || "") : "";
      const heroOriginHref = originMode ? heroSourceUrl : "";
      const hero = heroBytes ? { sha256: heroBytes.sha256 } : null;
      const photoSource = heroMediaSelection.heroOrigin === "extracted_hero" ? "client_hero_extracted"
        : heroMediaSelection.heroOrigin === "extracted_og" ? "client_og_image"
        : banked
          ? (banked.current_hero ? "client_current_hero"
            : banked.identity_critical ? "identity_portrait"
            : "photo_bank")
        : heroBytes ? "first_usable_photo" : "none";
      if (!spec || !spec.selector) {
        heroWash = { applied: false, reason: "donor_hero_unmeasured" };
      } else if (!hero) {
        // RUNGS 3/4, DECIDED AND REPORTED — never double-painted. With no
        // client-owned hero (no extraction lane, no bank, no usable photo),
        // the honest hero surface is the donor's own base: the verbatim
        // ports' drawn compositions/textures (hero_note per donor) or the
        // WSS neutral asset heroMediaSelection.neutralAsset just named — a
        // neutral trade surface that cannot be mistaken for this client's
        // project evidence. Painting a SECOND scrim over a design's own hero
        // is the flattening the verbatim campaign removed, so rung 3 ships
        // as the donor base plus this report; rung 4 (no neutral asset
        // either) is the themed slab the theme pass already paints in the
        // accent-derived palette — solidHeroCss in hero-media.js is its CSS
        // twin for a donor that opts in.
        heroWash = { applied: false, reason: "no_hero_grade_photo" };
      } else if (!heroBytes || (!originMode && !heroBytes.bytes)) {
        heroWash = { applied: false, reason: "hero_photo_bytes_not_fetched" };
      } else {
        const ext = heroBytes.ext === "jpeg" ? "jpg" : heroBytes.ext;
        const rel = `assets/hero-wash.${ext}`;
        // CINEMATIC DARK HERO (owner, on the live Family Heating hero: the video
        // is "buried under a flat blue"). heroWashCss walks its scrim from the
        // colour it is GIVEN toward the dark anchor and STOPS the moment white
        // text passes — so the previous call, which handed it the raw accent,
        // stopped at step 0 and painted the accent (#005DAC) at ~0.92 alpha: the
        // flat blue smother the owner sees. The scrim base is now darkened HEAVILY
        // toward near-black BEFORE the walk (85% #0b1220, a hint of the client hue
        // surviving), so the proven scrim is dark — the video reads through it as
        // a moody cinematic scene — while white headline + accent still clear AA.
        // The anchor stays #0b1220 and the headline is forced white just below.
        const scrimBase = darkenForScrim(
          brandOut.accent || (themePalette ? themePalette.slab : spec.background) || "",
        );
        const built = heroWashCss({
          imageHref: originMode ? heroOriginHref : `/${rel}`,
          accent: scrimBase,
          scrimHex: "#0b1220",
          textHex: "#ffffff",
          // The sub-line and reviews line are painted one step dimmer than the
          // headline (heroTextCss below); proving the scrim for white alone
          // left that ink at 3.9:1 worst-case — the near-transparent reviews
          // line the owner measured. The alpha is now proven for BOTH inks.
          inkFloorHex: HERO_SUB_INK,
          selectors: [spec.selector],
        });
        if (built.applied) {
          if (!originMode) files[rel] = heroBytes.bytes;
          heroWashOwnedSha = heroBytes.sha256 || null;
          // Appended to the LAST stylesheet — after the theme sheet — so the
          // wash's background-image wins on source order wherever the donor
          // set its own, while the theme's slab background-color (a different
          // property) composes underneath the photograph.
          const cssRels = Object.keys(files).filter((r) => /\.css$/i.test(r)).sort();
          const cssRel = cssRels[cssRels.length - 1];
          if (cssRel) {
            files[cssRel] = Buffer.concat([files[cssRel], Buffer.from(built.css, "utf8")]);
            // THE HERO INK — the pair to the dark scrim above, owned and
            // documented by lib/hero-wash.js (heroTextCss). The theme ink and
            // applyLiteralHues can leave the headline dark-navy or accent-blue;
            // a gradient-text donor's -webkit-text-fill-color: transparent
            // ignores a color override outright; and opacity-tinted rating
            // lines ship as transparent text. heroTextCss forces solid proven
            // inks for the h1 (all three composed lines, the reviews sentence
            // included) and the adjacent sub-line paragraph — the same inks
            // the scrim alpha above was proven against. Appended after the
            // theme sheet so it wins on source order; its !important is a
            // hero-only override of the theme tint, not part of the
            // heroWashCss output the contrast test guards.
            //
            // THE LIGHT-THEME TWIN (final QA Class B, 2026-09-04): in light
            // mode the theme re-dresses the donor's own hero layers to pale
            // tints that paint OVER the wash (they sit inside the section,
            // above its background), so the forced white pair loses its dark
            // surface and measured 1.1-1.6:1 on the pale composite. The call
            // also passes the light palette's proven band inks (slab ink and
            // its muted step — the pair walked against the very slab the
            // donor scrim is repointed to) and heroTextCss restates the pair
            // light-scoped, winning only where the pale surfaces ship.
            const ink = (() => {
              const lightSide = themePalette
                ? (themePalette.mode === "light" ? themePalette : themePalette.counterpart)
                : null;
              return heroTextCss({
                selector: spec.selector,
                lightInk: lightSide && lightSide.slabInk ? lightSide.slabInk : "",
                lightSubInk: lightSide && lightSide.slabMuted ? lightSide.slabMuted : "",
              });
            })();
            files[cssRel] = Buffer.concat([files[cssRel], Buffer.from(ink.css, "utf8")]);
            // THE COLOR GRADE (hero-media.js heroOverlayCss) — when the hero
            // photo is the CLIENT'S OWN (extracted from their live site, or
            // the bank row the lane flagged as their current hero), a
            // brand-palette veil at ~30% opacity sits BETWEEN the proven
            // scrim and their photograph: the photo becomes the design
            // surface while staying recognizable as THEIRS, and the AA proof
            // is untouched (the scrim is unchanged on top and its worst-case
            // bound holds for any backdrop, graded or not). Bank/gallery
            // photography and the neutral rungs get no grade — there is
            // either no brand-hero claim to honor or nothing of theirs to
            // keep recognizable.
            if (heroMediaSelection && heroMediaSelection.overlay) {
              const grade = heroMediaLib.heroOverlayCss({
                selector: spec.selector,
                accent: brandOut.accent || scrimBase || "",
                wash: built,
                imageHref: originMode ? heroOriginHref : `/${rel}`,
              });
              heroMediaGrade = grade;
              if (grade.applied) {
                files[cssRel] = Buffer.concat([files[cssRel], Buffer.from(grade.css, "utf8")]);
              }
            }
            // HVAC's hero call is an OUTLINE button: its donor rule gets its
            // ink from --primary-foreground, which the light theme correctly
            // makes dark for pale slabs. The cinematic wash makes this ONE
            // slab dark again, though, so the transparent button became dark
            // text on the proven dark scrim at every viewport. Reuse the exact
            // headline ink the scrim proof already covers. This must stay
            // HVAC-only: electrical-livewire's hero call is a pale FILLED
            // button and forcing that fleet-wide would make it white-on-light.
            if (donorOut.name === "hvac-premier") {
              // In the light state the pale themed hero layers paint over the
              // wash (see the ink twin above), so the outline call wears the
              // same light-side slab ink there instead of the dark-wash white.
              const lightSide = themePalette
                ? (themePalette.mode === "light" ? themePalette : themePalette.counterpart)
                : null;
              const heroCallCss = [
                "",
                "/* --- wss HVAC outline hero-call: proven ink on dark wash -------- */",
                `:is(${spec.selector}) [data-cta="hero-call"] {`,
                `  color: ${ink.headline} !important;`,
                `  -webkit-text-fill-color: ${ink.headline} !important;`,
                `  border-color: color-mix(in srgb, ${ink.headline} 40%, transparent) !important;`,
                "}",
                ...(lightSide && lightSide.slabInk ? [
                  `:root:not([data-wss-theme="dark"]):not(.dark) :is(${spec.selector}) [data-cta="hero-call"],`,
                  `[data-wss-theme="light"] :is(${spec.selector}) [data-cta="hero-call"] {`,
                  `  color: ${lightSide.slabInk} !important;`,
                  `  -webkit-text-fill-color: ${lightSide.slabInk} !important;`,
                  `  border-color: color-mix(in srgb, ${lightSide.slabInk} 40%, transparent) !important;`,
                  "}",
                ] : []),
                "",
              ].join("\n");
              files[cssRel] = Buffer.concat([files[cssRel], Buffer.from(heroCallCss, "utf8")]);
            }
            heroWash = {
              applied: true,
              reason: "",
              alpha: built.alpha,
              worstCaseRatio: built.worstCaseRatio,
              // 0 means the client's accent carried the scrim unaided; 1 means
              // it is the themed hero colour and the accent contributed
              // nothing. Anything between is how far the accent had to be
              // walked to keep the hero text above 4.5:1.
              tintMix: built.tintMix,
              // The sub-line/reviews ink's own worst-case ratio at the shipped
              // alpha — the second guarantee, beside worstCaseRatio's headline.
              inkFloorRatio: built.inkFloorRatio == null ? null : built.inkFloorRatio,
              ink: { headline: ink.headline, sub: ink.sub },
              scrim_basis: themePalette ? "themed_slab" : "donor_manifest_sample",
              selector: spec.selector,
              stylesheet: cssRel,
              photoSource,
              // Exact fetched bytes and their verified public origin. Both are
              // signed below so later Line recovery can prove which owned
              // photograph the base build actually painted, not merely that
              // some photo from the right source class existed.
              photo_sha: heroBytes.sha256 || null,
              photo_url: heroSourceUrl || null,
              pages_verified: Array.isArray(spec.pages_verified) ? spec.pages_verified : [],
            };
          }
          // A donor with no stylesheet has nowhere to put the block; the photo
          // must not ship as an orphan asset that nothing references.
          if (!heroWash.applied) { delete files[rel]; heroWash = { applied: false, reason: "donor_has_no_stylesheet" }; }
        } else {
          heroWash = { applied: false, reason: built.reason || "cannot_guarantee_contrast" };
        }
      }
    }

    // 9a-quinquies. THE HERO POSTER PASS (lib/mirror-engine/hero-poster.js,
    // audit A1 2026-09-03). The donor's hero-poster photo slot is the
    // first-second surface AND — because the video ladder never arms below
    // 1024px — the PERMANENT mobile hero. The slot-fill above can leave it
    // in three defective states: extension-drifted references with no
    // shipped-bytes guarantee, the donor's drawn svg placeholder on
    // empty-pool builds, or an unvetted pool[0] photograph (a service-area
    // MAP shipped as a Spring TX hero). This pass re-owns the slot: a
    // provenance- and region-gated photograph under its real extension,
    // every reference form rewritten to that one path, an onerror fallback
    // to the donor's bundled real poster photograph, and — when nothing
    // qualifies — the references pointed straight at that neutral trade
    // photo. Only donors whose manifest ships a REAL raster poster enter
    // the pass; the drawn-svg-poster donors (fencing-sterling, medspa-luma,
    // professional-services-estimator) are left untouched by construction.
    const heroPoster = heroPosterLib.applyHeroPosterPass({
      files,
      manifest: donorOut.manifest,
      donorDir: donorOut.dir,
      facts: request.facts,
      vertical: request.facts && request.facts.industry,
      usablePhotos,
      bank: request.brand && request.brand.photo_bank,
      prospectId: buildProspectId({ slug: request.slug, facts: request.facts }),
      originMode,
      heroWashPhoto: heroWash.applied && heroWash.photo_url ? { url: heroWash.photo_url, sha256: heroWash.photo_sha || "" } : null,
    });


    // THE HERO-VIDEO LADDER, FINALIZED — after the wash on purpose: the
    // stock-fallback suppression (A3, finalizeHeroArtifact above) fires only
    // when the client's own photograph owns the hero (heroWash.applied) and
    // no client clip shipped, so the wash verdict must exist first.
    const heroArtifact = finalizeHeroArtifact({
      files,
      manifest: donorOut.manifest,
      heroVideoSlot,
      heroVideoPlaced,
      heroVideoProvenance: request.brand?.hero_video?.provenance,
      heroWashApplied: heroWash.applied,
    });

    // CLASS D (final-qa verdict-matrix 2026-09-04, bradley). The hero
    // video's emitted references must resolve to SHIPPED bytes at every
    // serving prefix. The donors' ladder walkers root-absolutize their
    // rungs at runtime (`"/"+src`) and the hvac-premier family's
    // paint-under CSS names `/hero/hero-poster.jpg` root-absolute — under
    // any mount-below-prefix server those 404, the poster never paints,
    // every rung errors, and the dead video renders as a blank rectangle
    // occluding the real hero. This pass rewrites every such reference to
    // the depth-correct site-relative form and neutralizes the walkers'
    // absolutization so the island's own rungs are used verbatim. The
    // compile-time ships assertion (9z-2, after every other pass) then
    // proves the tree. The runtime visibility laws are untouched: the
    // video stays hidden until a real loaded frame, the poster photograph
    // stays the visible-by-default surface.
    const heroVideoPaths = heroVideoPathsLib.applyHeroVideoPathPass({
      files,
      manifest: donorOut.manifest,
    });

    // 9a-quater. THE MOBILE FOLD — "too busy, no personality" (owner, on his
    // phone, 2026-08-12). The donor heroes stack an eyebrow, a two-line
    // headline, a rating sentence, a lead paragraph, two CTAs, a chip row and
    // a stat card into the first mobile screenful. The owner's spec for what a
    // phone shows before scrolling: name/logo, ONE line (their slogan if
    // proven, else trade+city), rating stars, call button. The rest scrolls.
    //
    // Scoped to the donor's PROVEN hero selector (the hero_wash spec — the one
    // selector we know reaches the hero and nothing else), max-width 640px, so
    // desktop is byte-identical and donors without a proven selector are
    // untouched and say so.
    //
    // THE ONE LINE: identity-copy composes the h1 as line A (their slogan, or
    // their name) <br> line B (trade+city) <br> line C (rating sentence). When
    // the slogan led, everything after the first <br> hides — the fold reads
    // slogan only. When the name led, the h1's own text node IS the name the
    // header logo already shows, so the h1 collapses to its first <span> —
    // line B, trade+city — via font-size:0 on the h1 and a restored size on
    // the span (a text node cannot be display:none'd, its parent can be
    // zeroed). The rating SENTENCE always hides here; the stars live in the
    // #trust strip hoisted directly under the hero, which is the fold's
    // rating-stars row.
    let mobileFold = { applied: false, reason: "donor_hero_unmeasured" };
    {
      const spec = donorOut.manifest && donorOut.manifest.hero_wash;
      if (spec && spec.selector) {
        const sel = spec.selector;
        const sloganLed = copy.source === "client_tagline" || copy.source === "request_override";
        const keep = sloganLed ? "slogan_line_a" : "trade_city_line_b";
        const rawTrade = String(request.facts.industry || "Local service").replace(/[-_]+/g, " ").trim();
        const mobileTrade = rawTrade.replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/^Hvac$/, "HVAC");
        const mobilePlace = [request.facts.city, request.facts.state].map((value) => String(value || "").trim()).filter(Boolean).join(", ") || "your area";
        const mobileLine = `${mobileTrade} in ${mobilePlace}`.replace(/\s+/g, " ").trim();
        const mobileLineCss = mobileLine.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r?\n/g, " ");
        const lines = [
          "",
          "/* --- wss mobile fold (owner spec 2026-08-12): name/logo, ONE line,",
          "   rating stars, call button — the rest scrolls. Desktop untouched. */",
          "@media (max-width: 640px) {",
          // The froth: eyebrow (a <p>), lead paragraph, chip rows, stat cards,
          // vertical file-margin asides. Hidden inside the hero only.
          `  :is(${sel}) :is(p, ul, dl, aside) { display: none !important; }`,
          `  :is(${sel}) div:has(> dl) { display: none !important; }`,
          // SIDE COLUMNS SCROLL — they do not stack under the headline.
          // Measured on the rebuilt Family Heating mirror: the hero's framed
          // 520px image card stacked below the copy and pushed the #trust
          // stars to y=1177 on an 844px viewport. The hero keeps only the
          // column that carries the h1; sibling columns (the image card, the
          // file-margin rail) hide on the phone. The wash already puts their
          // photograph behind the hero, so nothing of theirs is lost.
          // The stacked spacing was designed for a desktop composition;
          // compress the hero's own padding and grid gap so the strip beneath
          // it is on the first screenful.
          `  :is(${sel}) > div { padding-top: 16px !important; padding-bottom: 28px !important; gap: 12px !important; }`,
        ];
        // Hide the side media only when a verified client photograph is
        // genuinely washed behind the hero. Without a wash, this column is
        // the donor's only useful hero media and must remain visible.
        if (heroWash.applied) {
          lines.push(`  :is(${sel}) > div > div:not(:has(h1)) { display: none !important; }`);
        }
        // Mute the donor's decorative veils (mesh/grid/hatch/watermark) on the
        // mobile fold (owner cinematic-hero, 2026-08-13) so the light-scrim photo
        // reads vivid instead of veiled. Per-donor opt-in via BOILERPLATE
        // hero_wash.mobile_mute; default empty = every other donor and the whole
        // desktop composition are byte-identical.
        const heroMute = Array.isArray(spec.mobile_mute)
          ? spec.mobile_mute.filter((s) => typeof s === "string" && s.trim())
          : [];
        if (heroMute.length) lines.push(`  :is(${sel}) :is(${heroMute.join(", ")}) { opacity: 0 !important; }`);
        if (sloganLed) {
          lines.push(
            `  :is(${sel}) h1 br, :is(${sel}) h1 br ~ * { display: none !important; }`,
            // Their sentence, one screen wide: the donor's 42px display size
            // wraps a real slogan five lines deep on a phone.
            `  :is(${sel}) h1 { font-size: clamp(26px, 8vw, 34px) !important; line-height: 1.15 !important; margin-top: 12px !important; }`,
          );
        } else {
          lines.push(
            `  :is(${sel}) h1 { display: block !important; visibility: visible !important; opacity: 1 !important; min-height: 40px !important; font-size: 0 !important; line-height: 0 !important; }`,
            `  :is(${sel}) h1 > * { display: none !important; }`,
            // Inherit the h1's actual shipped ink. When a cinematic wash is
            // present heroTextCss has already forced and proven that ink; the
            // old global slab token stayed dark in light mode and overrode it.
            `  :is(${sel}) h1::after { content: "${mobileLineCss}"; display: block !important; font-size: clamp(26px, 8vw, 34px) !important; line-height: 1.15 !important; color: inherit !important; -webkit-text-fill-color: currentColor !important; }`,
          );
        }
        // wss-mobile-dock-font-fallback: the mobile contact rail must stay
        // inside its two tracks even when a remote display font is slow or
        // unavailable. The HVAC donor additionally ships a 6,000px max-content
        // marquee and intentionally off-canvas decorative glows. Its real controls
        // and content are bounded below; the page root clips only those visual
        // bleeds instead of deleting them, so the cinematic design is preserved.
        lines.push(
          `  [data-cta="dock-call"], [data-cta="dock-quote"] { box-sizing: border-box !important; width: 100% !important; min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; padding-left: 8px !important; padding-right: 8px !important; gap: 6px !important; }`,
          `  [data-cta="dock-call"] > span, [data-cta="dock-quote"] > span { min-width: 0 !important; max-width: 100% !important; }`,
          `  [data-cta="dock-call"] > span:last-child, [data-cta="dock-quote"] > span:first-child { flex: 1 1 auto !important; overflow: hidden !important; }`,
          `  [data-cta="dock-call"] > span:last-child > span:first-child, [data-cta="dock-quote"] > span:first-child > span:first-child { max-width: 100% !important; overflow: hidden !important; letter-spacing: .11em !important; white-space: nowrap !important; }`,
          `  [data-cta="dock-call"] > span:last-child > span:last-child, [data-cta="dock-quote"] > span:first-child > span:last-child { display: block !important; max-width: 100% !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-size: clamp(12px, 3.35vw, 15px) !important; }`,
          `  [data-cta="dock-quote"] > svg { flex: 0 0 auto !important; width: 14px !important; height: 14px !important; }`,
          `  :is(${sel}) { overflow-x: clip !important; }`,
        );
        if (donorOut.name === "hvac-premier") {
          lines.push(
            `  html, body { box-sizing: border-box !important; max-width: 100% !important; overflow-x: clip !important; }`,
            `  .mask-fade-edges { min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; }`,
            `  .animate-marquee { animation: none !important; transform: none !important; width: 100% !important; min-width: 0 !important; max-width: 100% !important; gap: 0 !important; }`,
            `  .animate-marquee > * { display: none !important; }`,
            `  .animate-marquee > :first-child { display: flex !important; min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; }`,
            `  .animate-marquee > :first-child > * { min-width: 0 !important; }`,
            `  .animate-marquee > :first-child > :nth-child(2) { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }`,
          );
        }
        // ONE button on the fold: the call button. The quote CTA hides only
        // when a phone CTA genuinely exists to take its place — the donors
        // stamp both with data-cta, so presence is checked on the shipped
        // bytes, never assumed. Both spellings are the same attribute: the
        // donor's prerendered HTML serializes it data-cta="hero-call", the
        // compiled JSX bundle carries it as "data-cta":"hero-call".
        const shipsCallCta = phoneDigits && Object.entries(files).some(([rel, buf]) => {
          if (!/\.(html|js)$/i.test(rel)) return false;
          const text = buf.toString("utf8");
          return text.includes('data-cta="hero-call"') || text.includes('"data-cta":"hero-call"');
        });
        if (shipsCallCta) {
          lines.push(`  :is(${sel}) [data-cta="hero-quote"] { display: none !important; }`);
        }
        lines.push("}", "");
        const css = lines.join("\n");
        const cssRels = Object.keys(files).filter((r) => /\.css$/i.test(r)).sort();
        const target = cssRels[cssRels.length - 1];
        if (target) {
          files[target] = Buffer.from(`${files[target].toString("utf8")}\n${css}`, "utf8");
          mobileFold = { applied: true, reason: "", kept_line: keep, call_cta_kept: !!shipsCallCta, selector: sel, stylesheet: target };

          // A compiled donor can replace or discard the prerendered hero while
          // hydrating. CSS cannot restore an element that no longer exists, so
          // the shipped bytes carry one small, verified runtime recovery. It is
          // dormant on desktop and dormant whenever the donor keeps a visible
          // hero headline.
          //
          // CLASS C LAW (final-qa verdict-matrix 2026-09-04: hage,
          // searchfunder, nm-authority). The old recovery BUILT a generic
          // "trade in city" panel and hid the real hero behind it whenever the
          // h1 read as invisible at 900ms — a hydration/reveal race turned the
          // real mobile hero into a flat photo-less substitute mid-load
          // (probe heroH 1338→0, H1 text replaced). The recovery is now
          // CONTENT-PRESERVING: it never creates a panel, never hides the
          // hero, never substitutes copy. Its only move is the #703/#707
          // force-reveal applied to the REAL hero's own h1 — the same
          // "content is never hidden as its pre-JS state" law the
          // first-impression net enforces page-wide, scoped to the hero the
          // swap used to destroy. A hero whose h1 has not mounted yet is
          // retried on later ticks, never replaced: the real photograph and
          // the real H1 survive at every viewport and every timing.
          const heroSelectorJson = JSON.stringify(sel);
          const recoveryScript = `<script id="wss-mobile-hero-recovery">(()=>{const heroSelector=${heroSelectorJson};const visible=(node)=>{if(!node)return false;const style=getComputedStyle(node);const rect=node.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity||1)>.01&&rect.width>1&&rect.height>1};const reveal=(h1)=>{try{h1.style.transition="none";h1.classList.add("in");h1.classList.remove("reveal-armed");document.documentElement.classList.remove("js-reveal-armed");h1.style.setProperty("display","block","important");h1.style.setProperty("visibility","visible","important");h1.style.setProperty("opacity","1","important");}catch(e){}};const recover=()=>{try{if(!matchMedia("(max-width:640px)").matches)return;const hero=document.querySelector(heroSelector);if(!hero)return;if(visible(hero.querySelector("h1")))return;const h1=hero.querySelector("h1");if(!h1)return;reveal(h1);hero.setAttribute("data-wss-mobile-hero-real","true");document.documentElement.setAttribute("data-wss-mobile-hero-recovered","true");}catch(e){}};const boot=()=>{setTimeout(recover,900);setTimeout(recover,1800);setTimeout(recover,3500)};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot()})();<\/script>`;
          for (const [htmlRel, htmlBytes] of Object.entries(files)) {
            if (!/\.html?$/i.test(htmlRel)) continue;
            const html = htmlBytes.toString("utf8");
            if (html.includes('id="wss-mobile-hero-recovery"') || !/<\/body>/i.test(html)) continue;
            files[htmlRel] = Buffer.from(html.replace(/<\/body>/i, `${recoveryScript}</body>`), "utf8");
          }
        } else {
          mobileFold = { applied: false, reason: "donor_ships_no_stylesheet_to_append_to" };
        }
      }
    }

    // 9a-sexies. STRIP DONOR EDITORIAL CRUFT + KEEP THE THEME TOGGLE OFF THE
    // MOBILE HEADER (owner, on the live Family Heating hvac mirror: "terrible /
    // sloppy"). Three visual residues that ship on every mirror:
    //
    //  (1) Meaningless donor decorations — chapter marks, § section numbers,
    //      reel/field/read-time badges, interactive kickers. Blanked in the JS
    //      bundle (these donors are client-rendered SPAs; the text is only there)
    //      by stripDonorCruft. Surgical: only the decorative literals are emptied.
    //  (2) Giant faint section-number watermarks — a single arbitrary-size class
    //      (`text-[120px]`, always `text-outline`) the donor stamps behind each
    //      section. Hidden by an appended rule keyed to that exact class, and only
    //      when this magazine-style donor was actually detected (cruft blanked),
    //      so every other donor stays byte-identical. The business-name display
    //      (a different arbitrary size) is untouched.
    //  (3) The floating light/dark toggle overlaps the header logo/nav on a phone
    //      — it is fixed top-right, exactly where the mobile header sits. Docked
    //      to the bottom-left on <=640px (clear of the header and of the
    //      bottom-right chat/signal floaters). Appended after the theme sheet so
    //      it wins the cascade; desktop is untouched.
    let cruftReport = { blanked: 0, watermark_hidden: false, toggle_repositioned: false, placeholders_blanked: 0 };
    {
      const cruft = stripDonorCruft(files);
      cruftReport.blanked = cruft.blanked;
      // Forge-placeholder prose is blanked BEFORE the scans run, and the token
      // scan below now BLOCKS on any that survive — replace-or-drop at render,
      // fail-closed at the gate.
      cruftReport.placeholders_blanked = stripForgePlaceholders(files).blanked;
      // (2) giant section-number watermark — only for the magazine donor.
      if (cruft.blanked > 0) {
        const watermarkCss = "\n/* wss: hide donor giant faint section-number watermark */\n"
          + '.text-\\[120px\\]{display:none!important}\n';
        if (appendToLastCss(files, watermarkCss)) cruftReport.watermark_hidden = true;
      }
      // (3) theme toggle must never overlap the mobile header.
      if (themeReport.applied) {
        const toggleCss = "\n/* wss: keep the theme toggle off the mobile header (owner) */\n"
          + "@media (max-width:640px){"
          + ".wss-theme-toggle{top:auto!important;bottom:calc(86px + env(safe-area-inset-bottom))!important;right:auto!important;left:12px!important;}"
          + "}\n";
        if (appendToLastCss(files, toggleCss)) cruftReport.toggle_repositioned = true;
      }
    }

    // 9a-quinquies. A REAL FACE / CREW / VAN, SHOWN — not only washed faintly
    // behind the hero (owner, 2026-08-12: "homeowners want to see who is coming
    // to their door"). One ownership-gated photograph from the bank, written
    // here so content-inject can render it at full contrast in a "meet the team"
    // band. It EXCLUDES the photograph already behind the hero, so the band adds
    // a face rather than repeating the wash; when the only identity photograph
    // is the hero's, it is shown here anyway (the owner's whole point). Absent —
    // honestly — when the bank held no human/vehicle photograph.
    let identityPhoto = null;
    {
      const bank = request.brand && request.brand.photo_bank;
      const picked = contentInject.pickIdentityPhoto({
        bank,
        usablePhotos,
        excludeSha: (heroWash && heroWash.photo_sha) || "",
      });
      if (picked && picked.row && picked.row.bytes) {
        const ext = picked.row.ext === "jpeg" ? "jpg" : (picked.row.ext || "jpg");
        const rel = `assets/wss-people.${ext}`;
        files[rel] = picked.row.bytes;
        identityPhoto = { url: `/${rel}`, subject: picked.subject };
      }
    }

    // 9b. CONTENT injection — the Genie's verified services/FAQ/reviews/
    //     coverage/hours/story, a full JSON-LD graph, llms.txt, sitemap.
    //     Runs BEFORE the scans so injected markup is scanned like everything
    //     else, and its parse validity is re-proven below.
    let contentReport = { sections: 0, schema_nodes: 0 };
    if (Object.keys(publishContent).length) {
      const injected = contentInject.inject({
        files,
        content: publishContent,
        facts: { ...facts, industry: facts.industry },
        identityCopy: copy,
        phoneDigits,
        slug,
        logoUrl: logoPath,
        manifest: donorOut.manifest,
        // A REAL FACE / CREW / VAN, shown in a band — from the bank only.
        identityPhoto,
        // Their typeface has to be LOADED, not just named in a variable.
        fonts: brandOut.fonts || null,
        // Only validated resolved colours reach the chat renderer; the public
        // request never gets to stamp an arbitrary routing or identity value.
        brand: brandOut,
        // The left-side sign-up panel. Riley's line is resolved through
        // lib/riley-line (never a literal — that module exists because a
        // retired number once printed itself from a fallback), and
        // allowAgencyLine is TRUE here because the panel is unmistakably ours:
        // it opens with the WSS Labs mark, so the number reads as our
        // concierge rather than a second number on the client's own page.
        signup: request.signup || null,
      });
      for (const [rel, buf] of Object.entries(injected.files)) files[rel] = buf;
      contentReport = injected.report;

      // AUTHORITY PAGES (PROMPT B PHASE 2): real static /about, /service-areas
      // and /faq files. Vercel serves real files before the SPA catch-all, so
      // these are genuine crawlable pages with their own titles, schema,
      // bylines, cross-links and an outbound citation — the needs_content
      // points earned rather than asserted.
      const cssHref = Object.keys(files).find((f) => /^assets\/.*\.css$/i.test(f));

      // LOCAL SEARCH PLAN (Wave 4, gap report #6/#9): buildLocalSearchPlan was
      // a finished module with ZERO production callers — target terms, trust
      // signals, citations and a bounded content plan, all computed and then
      // thrown away while the engine guessed. It is wired now: computed from
      // the same verified facts the pages ship, written into the build as
      // local-search-plan.json, and its contentPlan bounds the multi-page set
      // (service pages, per-city chapters) generated below. content.areas are
      // the business's own published claims from the verified intake pipe, so
      // they enter as existing_site evidence — nothing unverified becomes a
      // page.
      const serviceNames = (publishContent.services || [])
        .map((s) => String((typeof s === "string" ? s : (s && s.name)) || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const localPlan = buildLocalSearchPlan({
        profile: { city: facts.city, state: facts.state, industry: facts.industry },
        gbp: {
          name: facts.business_name,
          address: facts.address,
          ...(facts.rating != null ? { rating: facts.rating } : {}),
          ...(facts.review_count != null ? { review_count: facts.review_count } : {}),
          ...(facts.latitude != null && facts.longitude != null
            ? { latlng: `${facts.latitude},${facts.longitude}` } : {}),
          serviceAreas: publishContent.areas || [],
        },
        nap: {},
        services: serviceNames,
        evidence: {
          source: "existing_site",
          serviceAreas: publishContent.areas || [],
          localities: (publishContent.areas || []).map((a) => ({ name: a, source: "existing_site", verified: true })),
        },
      });
      // DETERMINISM: the deployed tree must be a pure function of the request.
      // byteDiff decides whether an existing deployment may be RESUMED, and
      // localPlan carries `generatedAt: new Date().toISOString()` — a
      // millisecond wall clock that is NOT part of build_hash. So the hash said
      // "same build" while the bytes always differed, every resume probe failed,
      // both resume branches fell through silently, and the engine re-uploaded
      // and re-created a PAID deployment on every single attempt. Keep
      // generatedAt on the in-memory plan (nothing reads it off the deployed
      // file); just don't ship it.
      const { generatedAt: _planGeneratedAt, ...deterministicLocalPlan } = localPlan;
      files["local-search-plan.json"] = Buffer.from(JSON.stringify(deterministicLocalPlan, null, 2), "utf8");

      const authority = authorityPages.build({
        facts,
        phoneDigits,
        slug,
        content: publishContent,
        research: publishContent.research || null,
        cssHref: cssHref ? "/" + cssHref : "",
        localPlan,
        maxServicePages: localPlan.limits.servicePages,
        maxServiceAreaPages: Math.min(localPlan.limits.serviceAreaPages, 8),
      });
      for (const [rel, buf] of Object.entries(authority.files)) files[rel] = buf;
      contentReport.authority_pages = authority.report.pages;
      contentReport.authority_words = authority.report.words;
      contentReport.local_search_plan = {
        version: localPlan.version,
        status: localPlan.status,
        claim_level: localPlan.claimLevel,
        target_terms: localPlan.targetTerms.length,
        trust_signals: localPlan.trustSignals.length,
        service_pages: authority.report.pages.filter((p) => !/^\/(about|service-areas|faq|faqs|team)/.test(p) && !p.startsWith("/service-area/")).length,
        service_area_pages: authority.report.pages.filter((p) => p.startsWith("/service-area/")).length,
      };

      // NO ORPHAN PAGES (Wave 4): every authority page that shipped is linked
      // from the donor's own index. The strip is generated from the SAME page
      // set that was emitted, so a link to a page that did not ship is
      // structurally impossible — the same invariant the authority nav holds,
      // extended to the one page a crawler is guaranteed to start from.
      const pageLabels = authority.report.page_labels || {};
      if (Object.keys(pageLabels).length && files["index.html"]) {
        const strip = authorityPages.siteStrip(pageLabels);
        if (strip) {
          const idxHtml = files["index.html"].toString("utf8");
          files["index.html"] = Buffer.from(
            /<\/body>/i.test(idxHtml) ? idxHtml.replace(/<\/body>/i, `${strip}\n</body>`) : idxHtml + strip,
            "utf8",
          );
        }
      }

      // SEASONAL MERCHANDISING — feature-flagged, default OFF (facts.features
      // .seasonal). When on, lib/mirror-engine/seasonal renders the vertical's
      // current-month cards onto the home page using the site's own palette,
      // naming only services on the VERIFIED service list (its gate refuses
      // price/offer/urgency language and re-proves the certified binding over
      // the rendered bytes). Inside the content gate, because the certified
      // service list comes from publishContent — a build with no services
      // listed has nothing certified to say, so nothing renders.
      {
        const seasonal = require("./seasonal");
        const outcome = seasonal.injectSeasonalSection({
          html: files["index.html"] ? files["index.html"].toString("utf8") : "",
          facts: { ...facts, phone_digits: phoneDigits },
          services: serviceNames,
          now: new Date(),
        });
        if (outcome.html !== (files["index.html"] ? files["index.html"].toString("utf8") : "")) {
          files["index.html"] = Buffer.from(outcome.html, "utf8");
        }
        contentReport.seasonal = outcome.report;
      }

      // FLEET POLISH (2026-08-22 fleet audit: 61 duplicated-gallery, 127
      // sub-44px tap, and 26 dark-contrast findings across 13 live mirrors —
      // every donor, so the fix is a post-build pass over the compiled files,
      // never a per-donor edit). Duplicated gallery images are replaced with
      // unused client photos; one idempotent style block carries the mobile
      // 44px tap floor and the dark-mode text floor. A polish failure must
      // never fail a build — it skips and the site ships as-built.
      try {
        const polish = require("./fleet-polish");
        const stringFiles = fleetPolishInputFiles(files);
        // NO PROSPECT-DOMAIN HOTLINKS (owner order, 2026-09-04 render-
        // regression lane): the duplicate-gallery replacements used to be the
        // client photo URLS verbatim, which painted the prospect's origin
        // straight into our mirror's <img> tags — the donor-leakage marker
        // the 2026-09-04 fleet audit read on the broken builds. A replacement
        // may now only be a LOCAL path whose bytes actually ship in THIS
        // build. Where the client's photographs were fetched and housed
        // (media_mode "housed") the leftovers beyond the slots are written
        // in as first-party assets and those paths feed the dedup pass, so
        // the polish keeps its whole value with zero hotlinks. In origin
        // mode no bytes are housed, so the list is empty and duplicates of
        // the family's own bundled stock stay as-is — honest, and never a
        // dependence on the prospect's hotlink protection.
        const replacementUrls = [];
        if (!originMode) {
          for (const photo of usablePhotos) {
            if (!photo || !photo.bytes || placedPhotoShas.has(photo.sha256)) continue;
            const ext = String(photo.ext === "jpeg" ? "jpg" : photo.ext || "jpg").toLowerCase();
            const rel = `assets/wss-stock-${replacementUrls.length + 1}.${ext}`;
            files[rel] = photo.bytes;
            replacementUrls.push(`/${rel}`);
          }
        }
        // A11y floor context (2026-09-02): the verified facts sharpen the
        // composed alt sentences ("Absolute Roofing — roof replacement in
        // Naples, FL"). Optional by contract — the polish pass falls back to
        // the page's own published identity when absent.
        const polished = polish.polishSite(stringFiles, {
          replacementUrls,
          site: {
            businessName: facts.business_name,
            industry: facts.industry,
            city: facts.city,
            state: facts.state,
          },
        });
        for (const [rel, content] of Object.entries(polished.files)) {
          files[rel] = Buffer.from(content, "utf8");
        }
      } catch {
        /* fleet polish is best-effort by contract */
      }

      // Local-presence artifacts the packet specifies: the NAP citation pack
      // (a CSV an operator can work from) and the GBP copy pack in the three
      // required lengths. Both are generated from VERIFIED facts only.
      const rsrch = publishContent.research || null;
      if (rsrch && rsrch.citations_csv) files["citations.csv"] = Buffer.from(rsrch.citations_csv, "utf8");
      if (rsrch && rsrch.gbp) files["gbp-pack.json"] = Buffer.from(JSON.stringify(rsrch.gbp, null, 2), "utf8");
      // The sitemap is generated inside content-inject BEFORE these pages
      // exist, so it shipped home-only while four real pages were live —
      // orphaning them. Rewrite it here from the authority report itself (the
      // list of pages that ACTUALLY shipped, service and city chapters
      // included), so no new page type can be silently omitted again.
      {
        const siteUrl = `https://${slug}.wss-ai.com/`;
        const locs = [siteUrl].concat(
          authority.report.pages.map((p) => siteUrl + String(p).replace(/^\//, "")).sort(),
        );
        files["sitemap.xml"] = Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
          + locs.map((u, i) => `  <url><loc>${u}</loc><changefreq>monthly</changefreq><priority>${i === 0 ? "1.0" : "0.8"}</priority></url>`).join("\n")
          + `\n</urlset>\n`,
          "utf8",
        );
        contentReport.sitemap_urls = locs.length;
      }
      const parseFailures = parseGate(files);
      if (parseFailures.length) {
        return err(500, "content_parse_failed", parseFailures.slice(0, 5));
      }
    }

    // CHAT + 404 ARE BUILD FEATURES, NOT CONTENT-PACKET FEATURES. Authority
    // pages are created above, after the full content injector runs, while a
    // content-empty build skips that injector entirely. Ensure the real 404
    // exists first, then make one idempotent final pass over the complete HTML
    // tree so every future page carries the visitor relay in either path.
    if (!files["404.html"]) {
      files["404.html"] = contentInject.notFoundPage({ facts, phoneDigits });
    }
    {
      const prior = contentReport.chat_widget || {};
      const chat = contentInject.injectChatWidget({ files, facts, slug, brand: brandOut });
      for (const [rel, buf] of Object.entries(chat.files)) files[rel] = buf;
      contentReport.chat_widget = {
        present: Boolean(prior.present || chat.report.present),
        pages: (Number(prior.pages) || 0) + (Number(chat.report.pages) || 0),
        bytes: (Number(prior.bytes) || 0) + (Number(chat.report.bytes) || 0),
        reason: (prior.present || chat.report.present) ? "" : (chat.report.reason || prior.reason || "chat_not_emitted"),
      };
      const chatParseFailures = parseGate(files);
      if (chatParseFailures.length) {
        return err(500, "chat_injection_broke_markup", chatParseFailures.slice(0, 5));
      }
    }

    // FIRST-IMPRESSION NETS (2026-09-04 robustness lane; same seam and
    // idempotence contract as the hero-video ladder failsafe above). Runs
    // over the complete tree — index, 404, every authority page — so the
    // first second on a cold cache is protected on every page a visitor or
    // a capture tool can land on:
    //   · the reveal never-hidden net (visible-by-default floor + 900ms
    //     one-shot force-reveal) under every page that names a .reveal
    //     system, whatever donor it came from;
    //   · the hero frame-ready guard: a ladder-marked hero video paints
    //     only once it can actually draw (readyState >= 2) — until then the
    //     poster photograph and the painted hero surface own the first
    //     frame, never a black/gray rectangle.
    // A failure here must never fail a build — the nets skip and the site
    // ships as-built (same best-effort law as fleet polish).
    try {
      require("./first-impression").applyToFiles(files);
    } catch {
      /* first-impression nets are best-effort by contract */
    }

    // THE TAB IS IDENTITY TOO. Runs last, over the complete HTML tree, so the
    // 404 and every authority page get the same icon as the homepage.
    //
    // Until this pass existed the donor's favicon was copied straight through:
    // wss-test-sears-heating-and-cooling-columbus and
    // wss-test-air-creation-heating-and-cooling-llc-baton both served the SAME
    // 20373-byte /favicon.ico (md5 9f504444) — Lovable's, not either
    // company's. The header mark already fails closed on exactly this class of
    // defect (brand_logo_unreferenced, below); the tab did not, because a
    // favicon is fetched by PATH and needs no markup to be served. Deleting the
    // donor file is therefore the load-bearing half — see lib/mirror-engine/favicon.js.
    const favicon = applyFavicons({
      files,
      logo: brandOut.logo,
      businessName: facts.business_name,
      accent: brandOut.accent,
      primary: brandOut.primary,
    });
    const faviconParseFailures = parseGate(files);
    if (faviconParseFailures.length) {
      return err(500, "favicon_injection_broke_markup", faviconParseFailures.slice(0, 5));
    }

    // A DONOR MAY NOT NAME A TOWN. Runs over the complete HTML tree — the
    // donor's own JSON-LD as well as ours — for the same reason the favicon
    // pass does: the leak is in a file, not in a template.
    //
    // wss-test-monolith-tattoo-co-nashville, a NASHVILLE tattoo studio,
    // published South Congress, Cedar Park, Round Rock and Pflugerville as
    // areas served. All four are Austin, Texas, and all four are literals baked
    // into donors-clean/tattoo-aurelia's own index.html. Every gate passed it
    // and every gate was right: the strings are real towns, carry no token, and
    // name no third party. The only question with an answer is WHOSE town this
    // is — see lib/mirror-engine/area-fence.js.
    const areaFence = fenceAreasServed({ files, facts, content: publishContent });
    const areaParseFailures = parseGate(files);
    if (areaParseFailures.length) {
      return err(500, "area_fence_broke_markup", areaParseFailures.slice(0, 5));
    }

    // 9e. REPLAY THE CUSTOMER'S OWN EDITS — donor, then content, then THEM.
    //
    //     LAST FOR A REASON. Every edit was made against a page that already
    //     had its content, and a style_override is appended to <head> precisely
    //     so it outranks what the build put there. Replaying earlier would let
    //     the content stage overwrite the customer's own decision about their
    //     own site.
    //
    //     BEFORE THE SCANS FOR A REASON. Replayed bytes are shipped bytes, so
    //     they face the same parse gate, the same token scan, the same identity
    //     scan and the same route derivation as anything the engine composed
    //     itself. An edit cannot smuggle a donor's phone number back onto a
    //     mirror by riding in after the checks.
    const replayer = deps.replayEdits || replayEdits;
    // The baseline says what the log HELD, before any replay: a site whose only
    // history is an undo still reports that history rather than reading as a
    // site nobody has ever touched.
    let replayReport = {
      status: "none",
      applied: 0,
      entries: editLog.active.length,
      unreplayable: [],
      undone: editLog.revoked.length,
      ...(editLog.configured === false ? { store: "not_configured" } : {}),
    };
    if (editLog.active.length || editLog.legacy.length) {
      // CACHE-BUSTED, deliberately. A plain read of Supabase Storage answers
      // from the edge, and restoring a customer's page from a stale copy would
      // put back a version they had already changed — the bug in miniature.
      const readArchived = deps.readArchivedFile
        || (async (rel) => {
          try {
            const { downloadFresh } = require("../site-change-plan");
            return await downloadFresh(slug, rel);
          } catch {
            return null;
          }
        });
      let replayed;
      try {
        replayed = await replayer({ files, entries: editLog.active, readArchived });
      } catch (e) {
        return err(500, "edit_replay_failed", [{ reason: String(e.message || e).slice(0, 300) }]);
      }
      for (const [rel, buf] of Object.entries(replayed.files)) files[rel] = buf;

      const replayParseFailures = parseGate(files);
      if (replayParseFailures.length) {
        return err(500, "edit_replay_broke_markup", replayParseFailures.slice(0, 5));
      }

      replayReport = {
        ...replayReport,
        status: replayed.unreplayable.length || editLog.legacy.length ? "failed" : "passed",
        applied: replayed.applied.length,
        changed_files: replayed.changedFiles,
        restored_files: replayed.restoredFiles,
        ops: replayed.applied.slice(0, 20),
        // NAMED CASUALTIES, NOT A COUNT. Each one carries the job id, the date
        // and the customer's own words, so "which change did we lose" is a
        // question the manifest answers by itself.
        unreplayable: replayed.unreplayable,
        // Edits made before runSiteChange recorded a replayable form. Nothing
        // can bring these back; saying so is the whole point of listing them.
        legacy_unrecorded: editLog.legacy.map((l) => ({
          job_id: l.jobId, at: l.at, instruction: l.instruction, files: l.changedFiles,
        })),
      };

      // ==================================================================
      // DO NOT REPUBLISH A SITE THAT IS MISSING THE CUSTOMER'S CHANGES
      // ==================================================================
      // Reaching the deploy below would overwrite the live site AND the
      // archive with a tree that silently drops an edit the customer asked
      // for, was told was live, and can see on their page right now. That is
      // the failure this whole mechanism exists to end, so it stops HERE —
      // before a single byte is uploaded — and names what could not be
      // carried forward.
      //
      // The override is an operator decision taken deliberately and out of
      // band, never a default: MIRROR_ALLOW_EDIT_LOSS=1 says "rebuild anyway,
      // I know what is being dropped". Legacy entries do not block on their
      // own — there is nothing to preserve and blocking would freeze those
      // sites for ever — unless MIRROR_BLOCK_LEGACY_EDIT_LOSS=1 is set.
      const allowLoss = String(process.env.MIRROR_ALLOW_EDIT_LOSS || "").trim() === "1";
      const blockLegacy = String(process.env.MIRROR_BLOCK_LEGACY_EDIT_LOSS || "").trim() === "1";
      const blocking = [
        ...replayed.unreplayable,
        ...(blockLegacy ? editLog.legacy.map((l) => ({ jobId: l.jobId, at: l.at, op: "legacy", reason: l.reason, instruction: l.instruction })) : []),
      ];
      if (blocking.length && !allowLoss) {
        // AN ARRAY, ONE ENTRY PER CASUALTY. lib/mirror-lane-build.js only
        // forwards `detail` when it is an array (see its note about a 400 whose
        // field-level cause was being dropped), so an object here would reach
        // the operator's row as the bare words "customer_edits_would_be_lost"
        // with no way to tell WHICH change is at risk. Each entry stands on its
        // own: the job, the date, the customer's words, why it no longer fits,
        // and what to do about it.
        return err(409, "customer_edits_would_be_lost", blocking.map((b) => ({
          path: "/customer_edits",
          slug,
          job_id: b.jobId,
          at: b.at,
          op: b.op,
          reason: b.reason,
          instruction: b.instruction,
          // lib/line-adapters.js describeRefusal prefers `message`, so this is
          // the sentence that reaches the operator's row. It names the change
          // in the customer's own words rather than as an op code.
          message: `${b.instruction ? `"${b.instruction}"` : `a ${b.op} edit`} (${b.jobId}, ${String(b.at).slice(0, 10)})`
            + ` can no longer be replayed onto this build: ${b.reason}`,
          remedy: "re-apply this through the edit engine after the rebuild, or set MIRROR_ALLOW_EDIT_LOSS=1 to rebuild without it",
        })));
      }
      if (blocking.length && allowLoss) replayReport.loss_allowed_by_operator = true;
    }

    // 9f. LEGAL HYGIENE OF A CONCEPT SITE — noindex + attribution, on the exact
    //     tree the customer receives. Runs AFTER the edit replay (a page
    //     restored from the archive is held to the same contract as a page the
    //     engine composed) and BEFORE the stage-10 scans, so the audits measure
    //     the shipped bytes. Every .html gets both signals: the donor's own
    //     pages, the generated authority pages, the 404, and content-empty
    //     builds. Idempotent — see applyLegalHygiene in content-inject.js.
    //     The SiteForge customer lane and the edit engine do not come through
    //     here, so customer-owned production sites carry neither signal.
    {
      const hygiene = contentInject.applyLegalHygiene({ files });
      for (const [rel, buf] of Object.entries(hygiene.files)) files[rel] = buf;
      contentReport.legal_hygiene = hygiene.report;
      const hygieneParseFailures = parseGate(files);
      if (hygieneParseFailures.length) {
        return err(500, "legal_hygiene_broke_markup", hygieneParseFailures.slice(0, 5));
      }
    }

    // 9g. PROJECT GALLERY + PERFORMANCE PIPELINE (features 4 + 8, one flagged
    //     pass). Runs AFTER edit replay and legal hygiene — the customer's own
    //     edits are already in the tree, so the gallery cannot be overwritten
    //     and a restored page is still held to the same contract — and BEFORE
    //     the stage-10 scans, so the audits measure the exact shipped bytes.
    //     Both are feature-flagged with env kill switches (default ON, "0"
    //     disables): MIRROR_PROJECT_GALLERY and MIRROR_PERF_PIPELINE.
    //     A failure in either must never fail a build — the parse gates below
    //     are the only stop, for the same reason every injection pass here
    //     gates its own output.
    if (String(process.env.MIRROR_PROJECT_GALLERY ?? "1").trim() !== "0") {
      try {
        const gallery = projectGallery.injectProjectGallery({ files, facts });
        for (const [rel, buf] of Object.entries(gallery.files)) files[rel] = buf;
        contentReport.project_gallery = gallery.report;
        const galleryParseFailures = parseGate(files);
        if (galleryParseFailures.length) {
          return err(500, "project_gallery_broke_markup", galleryParseFailures.slice(0, 5));
        }
      } catch {
        /* the gallery is best-effort by contract: absent beats a broken build */
      }
    } else {
      contentReport.project_gallery = { present: false, pairs: 0, pages: 0, reason: "disabled_by_flag" };
    }
    if (String(process.env.MIRROR_PERF_PIPELINE ?? "1").trim() !== "0") {
      try {
        const perf = perfPipeline.applyPerfTransforms({
          files,
          siteUrl: `https://${slug}.wss-ai.com/`,
          // content-inject's hero_preload only exists on content builds; the
          // pipeline finds the hero asset itself so content-empty builds get
          // the same eager/preload treatment.
          heroAsset: contentReport.hero_preload || "",
        });
        for (const [rel, buf] of Object.entries(perf.files)) files[rel] = buf;
        contentReport.perf_pipeline = perf.report;
        const perfParseFailures = parseGate(files);
        if (perfParseFailures.length) {
          return err(500, "perf_pipeline_broke_markup", perfParseFailures.slice(0, 5));
        }
      } catch {
        /* the perf pipeline is best-effort by contract: as-built beats broken */
      }
    } else {
      contentReport.perf_pipeline = { status: "disabled_by_flag" };
    }

    // 9z. THE POSTER-SHIPS ASSERTION, FINAL FORM — after every other pass
    // (content-inject, theme, fleet polish, the perf pipeline) has had its
    // chance to touch the tree, every hero-poster reference on every page
    // must still resolve to shipped image bytes. This is the compile-time
    // proof the poster 404s of audit A1 asked for: a dangling or non-image
    // reference self-heals to the donor's bundled real poster here, and
    // the healed count ships in the manifest.
    if (heroPoster && heroPoster.applied) {
      heroPoster.assertion = heroPosterLib.assertHeroPosterShips({
        files,
        fallbackRel: heroPoster.fallback_rel,
      });
    }

    // 9z-duo. THE PHOTO-SHIPS ASSERTION (final-qa Class A, 2026-09) — every
    // image reference on every page must resolve to shipped image bytes and
    // every onerror fallback target with it (a chain whose second rung 404s
    // is the defect, not a mitigation). Two moves, lib/mirror-engine/
    // photo-ships.js: root-absolute /assets/... refs the engine itself
    // stamps (wss-people team photo, wss-stock lightbox, client-logo) are
    // normalized to page-depth-correct relative forms — root-absolute only
    // resolves on a domain-root deploy, never under the path-based local
    // viewer where Class A was scored — and dangling references or onerror
    // targets self-heal to the donor's bundled real photograph.
    //
    // SCOPED to the plumbing family in this lane: the rewrite changes
    // emitted bytes, and the other families' mirror-baseline caches pin
    // those bytes (their Class D root-absolute 404s are the same defect and
    // ride this pass the moment their baselines are re-pinned — the module
    // is donor-agnostic by construction).
    let photoShips = { applied: false, reason: "family_not_in_scope" };
    if (/plumbing/i.test(String(donorOut.name || ""))) {
      photoShips = photoShipsLib.applyPhotoShipsPass({
        files,
        manifest: donorOut.manifest,
        donorDir: donorOut.dir,
      });
      if (photoShips.assertion && !photoShips.assertion.ok) {
        // A build whose emitted pages still reference photos nobody ships,
        // after healing, is exactly the Class A shape — fail the build on
        // the evidence, not the vibe.
        return err(500, "photo_ships_assertion_failed", {
          dangling: photoShips.assertion.dangling.slice(0, 12),
          fallback_rel: photoShips.fallback_rel || null,
        });
      }
    }

    // 9z-2. THE HERO-VIDEO SHIPS ASSERTION, FINAL FORM — the Class D
    // compile-time proof, hero-poster's ships-assertion pattern extended to
    // the video ladder's src/poster. After every other pass has had its
    // chance to touch the tree, every video src/poster reference on every
    // page — poster attributes, <source src>, ladder-island rungs,
    // paint-under url()s, walker/bundle assignments — must resolve to
    // shipped bytes (raster image magic for posters, mp4/webm magic for
    // clips). A dangling poster heals to the shipped poster photograph; a
    // dangling clip heals to the shipped fallback clip or is dropped from
    // its island, so no build can ship a rung that 404s into a white
    // occluder. The video's hidden-until-a-real-loaded-frame law
    // (first-impression's frame-ready guard) and the poster's
    // visible-by-default state are the runtime half of the same guarantee.
    const heroVideoAssertion = heroVideoPathsLib.assertHeroVideoShips({
      files,
      manifest: donorOut.manifest,
      fallbackClipRel: heroVideoPaths.fallback_clip,
      fallbackPosterRel: heroVideoPaths.fallback_poster
        || (heroPoster && heroPoster.fallback_rel)
        || (heroPoster && heroPoster.poster_rel)
        || "",
    });

    // 10. Scans on the exact tree the customer receives.
    // Brand presence is a named check. A real logo must render; true logo
    // absence may use the frozen ladder's recorded wordmark/monogram and stays
    // revealable with a POLISH flag. An unrecorded generic fallback remains
    // unbranded.
    // An HTML comment is not the DOM. Counting one as a reference is how a
    // donor that merely MENTIONS the token would satisfy a gate it never
    // honours, so comments are stripped before anything is counted.
    const renderable = (rel, buf) => {
      const s = buf.toString("utf8");
      return /\.html$/i.test(rel) ? s.replace(/<!--[\s\S]*?-->/g, "") : s;
    };
    let logoSlots = 0;
    for (const [rel, buf] of Object.entries(donorFiles)) {
      if (!/\.(html|js|css)$/i.test(rel)) continue;
      const m = renderable(rel, buf).match(/\{\{LOGO_URL\}\}/g);
      if (m) logoSlots += m.length;
    }

    // BRAND-IN-DOM. The old check asked only whether a logo had been FETCHED,
    // so a build that wrote /assets/client-logo.png — HTTP 200, correct
    // content-type — into a donor that never references it reported
    // brand:"passed" while the header rendered the DONOR's own mark,
    // byte-identical across two different companies. Writing a file is not
    // wearing it. Everything below is measured on the exact tree the customer
    // receives, and absence FAILS.
    const logoRel = logoPath.replace(/^\//, "");
    const logoBytes = files[logoRel] || null;
    const logoShaInOutput = logoBytes ? createHash("sha256").update(logoBytes).digest("hex") : null;
    let logoRefs = 0;
    for (const [rel, buf] of Object.entries(files)) {
      if (!/\.(html|js|css|json|webmanifest)$/i.test(rel)) continue;
      logoRefs += renderable(rel, buf).split(logoPath).length - 1;
    }
    // Every /assets image the served HTML points at must have a file behind it.
    // A donor whose own mark was "sanitized" by substituting a token INSIDE the
    // filename hydrates to a path nothing answers — a broken <img>, not a
    // branded one. Reported for the whole tree; only the LOGO gates.
    const danglingImageRefs = [];
    for (const [rel, buf] of Object.entries(files)) {
      if (!/\.html$/i.test(rel)) continue;
      for (const m of renderable(rel, buf).matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:png|jpe?g|webp|svg|gif|avif))"/gi)) {
        const target = m[1].replace(/^\//, "");
        if (!(target in files) && !danglingImageRefs.includes(m[1])) danglingImageRefs.push(m[1]);
      }
    }
    const logoInDom =
      logoRefs > 0
      && !!logoBytes
      && (!brandOut.logo || logoShaInOutput === brandOut.logo.sha256);
    const markRung = !brandOut.logo && brandOut.mark
      ? String(brandOut.mark.rung || "").trim()
      : "";
    const markFallback = ["wordmark", "monogram", "donor_default"].includes(markRung)
      ? markRung
      : "";

    // DOES THE SHIPPED ACCENT SMELL LIKE A FRAMEWORK DEFAULT? The tattoo-shop
    // incident: a mirror went out wearing Tailwind orange-600 as "the client's
    // colour" while their logo is red — every gate green, because a stock hex
    // is a perfectly valid hex. checkAccent compares the shipped colour to the
    // Tailwind/shadcn/Bootstrap/MUI palettes (and to the client's own logo
    // colour, when one was measured) and answers framework_default /
    // suspicious / ok. REPORTED, NEVER GATING — same law as checks.content and
    // checks.optimization_108: a suspicious colour is a finding for the
    // operator, not a reason to block a build whose measurement may simply be
    // a client who genuinely picked Bootstrap blue. The logo reference for the
    // divergence check is the logo's own measured hex: the accent itself when
    // it WAS measured from the logo, or the colour a site-chrome win demoted
    // to secondary_accent. A shape the detector cannot parse yields null, not
    // a failed build.
    const defaultSuspect = (() => {
      if (!brandOut.accent) return null;
      try {
        const clientLogoAccent = /^measured_from_logo/.test(String(brandOut.accent_origin || ""))
          ? brandOut.accent
          : (brandOut.secondary_accent || null);
        return checkAccent(brandOut.accent, clientLogoAccent ? { clientLogoAccent } : {});
      } catch {
        return null;
      }
    })();

    const checks = {
      // Recorded here because `checks` is assembled below the stages that
      // produce it; the replay itself already ran, above, before any scan.
      customer_edits: replayReport,
      hydration_parse: { status: "passed", ...hydrated.report },
      pre_hydration_layout: preHydrationLayout,
      brand: {
        status: brandOut.logo
          ? (!logoInDom ? "failed" : brandOut.accent ? "passed" : "unbranded")
          : markFallback ? "passed"
          : !logoInDom ? "failed"
          : "unbranded",
        logo: brandOut.logo
          ? "client"
          : markFallback === "wordmark" ? "wordmark-fallback"
          : markFallback || "wordmark-fallback",
        mark: brandOut.mark || null,
        mark_fallback: markFallback || null,
        accent: brandOut.accent ? "measured" : "donor-default",
        // The EXACT hex the recolor loop painted with — not just the label
        // above. This is what makes the decision durable: release_evidence
        // carries this object onto the row, and prospects.brandTruthFromEvidence
        // distils it into record.brand_truth so the email wears THE SAME
        // colour the site shipped in. Before this field the shipped hex lived
        // nowhere a reader could reach it.
        accent_hex: brandOut.accent || null,
        accent_origin: brandOut.accent_origin || "none",
        // Which colour won — the site's chrome or the logo's dominant colour —
        // and why, whenever the lane supplied brand.site_accent. null means no
        // site measurement arrived, so there was nothing to weigh.
        accent_decision: brandOut.accent_decision || null,
        // The logo colour a site-chrome win demoted to the secondary paint
        // role (never the surface tint). null when nothing was demoted.
        secondary_accent: brandOut.secondary_accent || null,
        // The framework-default sniff computed above. A non-status field on
        // purpose: computeRevealable never reads it, so it can never gate.
        default_suspect: defaultSuspect,
        // Their typeface, so the operator can see at a glance whether the
        // mirror is set in the client's font or still in the donor's.
        fonts: brandOut.fonts
          ? `${brandOut.fonts.display || "?"} / ${brandOut.fonts.body || "?"} (${brandOut.fonts.provider || "declared"})`
          : "donor-default",
        // Exact immutable Packet2 receipt, already strict-validated at the
        // request boundary. It rides inside signed release evidence so a
        // deployed build can be traced to the snapshot that supplied its
        // optional palette/fonts/media/services without copying that packet —
        // or any secret/prospect data — into the manifest.
        ...(request.brand && request.brand.source_packet ? {
          source_packet: {
            contract: request.brand.source_packet.contract,
            packet_id: request.brand.source_packet.packet_id,
            snapshot_sha256: request.brand.source_packet.snapshot_sha256,
          },
        } : {}),
        logo_slots_in_donor: logoSlots,
        // The evidence that makes a false pass impossible to restate: the path
        // served, how many times the served markup actually points at it, and
        // the sha256 of the bytes behind it.
        logo_path: logoPath,
        logo_refs_in_output: logoRefs,
        logo_asset_shipped: !!logoBytes,
        logo_sha_in_output: logoShaInOutput,
        logo_sha_source: brandOut.logo ? brandOut.logo.sha256 : null,
        logo_in_dom: logoInDom,
        ...(danglingImageRefs.length ? { dangling_image_refs: danglingImageRefs.slice(0, 12) } : {}),
        photos: (() => {
          // THE PLACED COUNT A VISITOR CAN VERIFY. Slot placement first; then
          // the hero-wash photograph when it applied from a DIFFERENT owned
          // photo (a wash over an already-placed photograph is the same
          // picture seen twice, not two placements — never count it twice).
          const washCredit = heroWashOwnedSha && !placedPhotoShas.has(heroWashOwnedSha) ? 1 : 0;
          if (washCredit) placedPhotoShas.add(heroWashOwnedSha);
          // The wash photograph is shipped and seen; it is not "unplaced" and
          // must not keep a rejection reason against it.
          const reasons = photosUnplacedReasons.filter((r) => {
            const photo = usablePhotos.find((p) => p.url === r.url);
            return !(photo && placedPhotoShas.has(photo.sha256));
          });
          // Supplied photographs the resolver itself refused (fetch, sniff,
          // third-party mark) carry the refusal forward per asset — these were
          // ATTEMPTED, and the gate's law says an attempted-and-refused photo
          // is an explained gap, never a silent zero.
          for (const p of (brandOut.photos || [])) {
            if (p && !p.ok && p.url && p.reason) {
              reasons.push({ url: p.url, reason: `unusable_at_build:${String(p.reason).slice(0, 100)}` });
            }
          }
          return {
            supplied: (request.brand && request.brand.photos ? request.brand.photos.length : 0),
            usable: usablePhotos.length,
            placed: photosPlaced + washCredit,
            unplaced: Math.max(0, usablePhotos.length - placedPhotoShas.size),
            photos_unplaced: reasons,
            transcoded: photosTranscoded,
            ext_fallback: photosExtFallback,
            hero_wash_placed: washCredit,
            slots_in_donor: photoSlots.length,
            dead_slots: deadSlots,
          };
        })(),
        // HOTLINK-UNTIL-PAY: which media mode this build shipped in, and — in
        // origin mode — the URL map that replaces byte placement. The entries
        // carry the sha256 verified at build time, which is what the paid
        // migration re-checks before housing the bytes.
        media_mode: brandOut.mediaMode || "housed",
        ...(originMediaReport ? { origin_media: originMediaReport } : {}),
        hero_video: {
          supplied: Boolean(request.brand && request.brand.hero_video && request.brand.hero_video.url),
          // TRUE when the ladder's client clip came from the 5f live-site
          // extraction (an mp4/webm source inside their hero/header region)
          // rather than the request — same placement gates either way.
          extracted: heroVideoExtracted,
          usable: Boolean(brandOut.heroVideo && brandOut.heroVideo.ok),
          placed: heroVideoPlaced,
          provenance: heroArtifact.provenance,
          path: heroArtifact.path,
          sha256: heroArtifact.sha256,
          ...(heroArtifact.stock_fallback_suppressed ? {
            // The stock rung was deliberately withheld so it cannot hard-cut
            // over the client's photograph (A3); the empty ladder is the
            // design, not a miss.
            stock_fallback_suppressed: true,
            suppressed_fallback: heroArtifact.suppressed_fallback || null,
          } : {}),
          // CLASS D (final-qa 2026-09-04): the emitted video path law —
          // the root-absolute/walker repairs this build applied and the
          // final ships-assertion verdict over the shipped tree.
          paths: {
            applied: Boolean(heroVideoPaths && heroVideoPaths.applied),
            walker_fixes: (heroVideoPaths && heroVideoPaths.walker_fixes) || 0,
            rewrites: (heroVideoPaths && heroVideoPaths.rewrites) || 0,
            clips: (heroVideoPaths && heroVideoPaths.clips) || 0,
            posters: (heroVideoPaths && heroVideoPaths.posters) || 0,
            assertion: heroVideoAssertion || null,
          },
          ...(heroVideoReason ? { reason: heroVideoReason } : {}),
        },
        // The split-hero .hero-visual tile's aspect adaptation (A3(C)):
        // applied only when the placed tile photograph is landscape.
        ...(heroTileAspect && heroTileAspect.applied ? { hero_tile_aspect: heroTileAspect } : {}),
        // Their own photograph behind the hero, or the named reason it is not
        // there. `applied:true` here means a per-donor selector that was PROVEN
        // to paint by a before/after pixel diff — never merely that a rule was
        // written. worst_case_contrast is what the hero text clears against the
        // brightest (or darkest) photograph that could sit behind it.
        hero_wash: {
          applied: heroWash.applied,
          reason: heroWash.reason || null,
          alpha: heroWash.alpha || null,
          worst_case_contrast: heroWash.worstCaseRatio || null,
          // The dimmer sub-line/reviews ink's worst-case ratio at the same
          // alpha — proven beside the headline's, never assumed from it.
          ink_floor_contrast: heroWash.inkFloorRatio == null ? null : heroWash.inkFloorRatio,
          ...(heroWash.ink ? { ink: heroWash.ink } : {}),
          tint_mix: heroWash.tintMix == null ? null : heroWash.tintMix,
          // "themed_slab" means the scrim was proven against the colours the
          // theme pass actually painted the hero in; "donor_manifest_sample"
          // is the fallback for a build whose theme did not apply.
          scrim_basis: heroWash.scrim_basis || null,
          photo_source: heroWash.photoSource || null,
          photo_sha: heroWash.photo_sha || null,
          photo_url: heroWash.photo_url || null,
          selector: heroWash.selector || null,
          pages_verified: heroWash.pages_verified || [],
          // The ~30% accent color grade over the client's OWN hero photo
          // (lib/mirror-engine/hero-media.js) — present only when the wash
          // winner is client-owned hero imagery; null on bank-only, neutral
          // and solid-rung builds.
          ...(heroMediaGrade && heroMediaGrade.applied ? {
            color_grade: { alpha: heroMediaGrade.alpha, accent_rgb: heroMediaGrade.accentRgb },
          } : {}),
        },
        // THE HERO-MEDIA LADDER (lib/mirror-engine/hero-media.js) — what was
        // extracted from the client's live site at build time, what verified,
        // and which rung of the selection ladder this build shipped. A rung
        // 3/4 selection reports the honest surface (the donor's neutral base
        // / the accent solid) instead of leaving a generic stock-looking hero
        // unexplained.
        hero_media: {
          website: heroMediaWebsite || null,
          extraction: heroMedia.ok ? "verified" : (heroMedia.reason || "not_run"),
          candidates: heroMedia.candidates || 0,
          ...(heroMedia.hero ? {
            hero: {
              url: heroMedia.hero.url,
              sha256: heroMedia.hero.sha256,
              width: heroMedia.hero.width || null,
              height: heroMedia.hero.height || null,
              source: heroMedia.hero.source,
            },
          } : {}),
          ...(heroMedia.og ? {
            og: {
              url: heroMedia.og.url,
              sha256: heroMedia.og.sha256,
              width: heroMedia.og.width || null,
              source: "og_image",
            },
          } : {}),
          ...(heroMedia.video ? {
            video: { url: heroMedia.video.url, sha256: heroMedia.video.sha256, ext: heroMedia.video.ext },
          } : {}),
          ...(heroMedia.poster ? {
            poster: { url: heroMedia.poster.url, sha256: heroMedia.poster.sha256 },
          } : {}),
          ...(heroMedia.rejected && heroMedia.rejected.length
            ? { rejected: heroMedia.rejected.slice(0, 8) }
            : {}),
          selection: heroMediaSelection ? {
            choice: heroMediaSelection.choice,
            rung: heroMediaSelection.rung,
            reason: heroMediaSelection.reason || null,
            ...(heroMediaSelection.neutralAsset ? { neutral_asset: heroMediaSelection.neutralAsset.rel } : {}),
          } : null,
          cross_prospect_guard: "client_domain_bound_plus_sha_registry",
        },
      },
      hero_provenance: heroArtifact,
      // THE HERO POSTER, OWNED END TO END (lib/mirror-engine/hero-poster.js,
      // audit A1 2026-09-03). `choice` is whose photograph the tile ships;
      // `poster_rel`/`poster_sha` the emitted bytes; `fallback_rel` the
      // donor's bundled real photograph behind the onerror guard;
      // `assertion` the compile-time proof that every hero-poster reference
      // on every page resolves to shipped image bytes (post-heal).
      hero_poster: {
        status: heroPoster.applied ? "applied" : "skipped",
        reason: heroPoster.reason || null,
        choice: heroPoster.choice || null,
        poster_rel: heroPoster.poster_rel || null,
        poster_sha: heroPoster.poster_sha || null,
        poster_ext: heroPoster.poster_ext || null,
        fallback_rel: heroPoster.fallback_rel || null,
        onerror_pages: heroPoster.onerror ? heroPoster.onerror.pages : 0,
        rewrites: heroPoster.rewrites || 0,
        ...(heroPoster.selection ? {
          selection: {
            choice: heroPoster.selection.choice || null,
            reason: heroPoster.selection.reason || null,
            region: heroPoster.selection.region || null,
            ranked: heroPoster.selection.ranked || [],
            rejected: heroPoster.selection.rejected || [],
          },
        } : {}),
        ...(heroPoster.assertion ? {
          poster_ships: heroPoster.assertion.ok,
          refs_checked: heroPoster.assertion.refs || 0,
          refs_healed: heroPoster.assertion.healed || 0,
        } : {}),
        provenance: { schema: "wss.hero-poster.v1", copy_slot: "hero_poster" },
      },
      // THE PHOTO-SHIPS ASSERTION'S PROVENANCE (final-qa Class A, 2026-09):
      // the tree-wide img law over the exact bytes the customer receives.
      photo_ships: {
        status: photoShips.applied ? "applied" : "skipped",
        reason: photoShips.reason || null,
        fallback_rel: photoShips.fallback_rel || null,
        ...(photoShips.normalize ? {
          root_absolute_normalized: photoShips.normalize.rewritten || 0,
          normalize_pages: photoShips.normalize.pages || 0,
          css_files_normalized: photoShips.normalize.css_files || 0,
        } : {}),
        ...(photoShips.assertion ? {
          all_refs_ship: photoShips.assertion.ok,
          refs_checked: photoShips.assertion.refs || 0,
          refs_resolved: photoShips.assertion.resolved || 0,
          refs_healed: photoShips.assertion.healed || 0,
          onerror_targets_fixed: photoShips.assertion.onerror_fixed || 0,
        } : {}),
        provenance: { schema: "wss.photo-ships.v1" },
      },
      // THE CLIMATE COPY GUARD'S PROVENANCE (audit A1): what the region
      // licensed, and every climate claim it had to swap.
      copy_slot: {
        region_guard: {
          applied: climateGuard.applied,
          pages: climateGuard.pages || 0,
          climate: climateGuard.climate || "unknown",
          region: climateGuard.region || null,
          reason: climateGuard.reason || null,
          ...(climateGuard.replacements && climateGuard.replacements.length
            ? { replacements: climateGuard.replacements.slice(0, 12) }
            : {}),
        },
      },
      // The owner's phone-fold spec: name/logo, ONE line, rating stars, call
      // button — everything else scrolls. Applied only inside a donor's proven
      // hero selector; kept_line says which line survived and why.
      mobile_fold: {
        status: mobileFold.applied ? "applied" : "skipped",
        reason: mobileFold.reason || null,
        kept_line: mobileFold.kept_line || null,
        call_cta_kept: mobileFold.call_cta_kept == null ? null : mobileFold.call_cta_kept,
      },
    };
    // The tab icon, measured on the shipped tree. `source` says whose pixels
    // these are: "client_logo" their own mark, "monogram" the honest refusal to
    // guess one. Never the donor's — that is what `clean` proves.
    checks.favicon = {
      status: favicon.report.clean
        ? favicon.report.source === "none" ? "none" : "passed"
        : "failed",
      ...favicon.report,
    };
    // THE THEME, with its measured contrast ratios rather than a claim that it
    // is readable. "skipped" is a real outcome, not a failure: a donor with no
    // stylesheet, or a palette that could not clear 4.5:1, keeps the donor's own
    // theme and says which of the two happened.
    checks.theme = themeReport.applied
      ? { status: "passed", ...themeReport }
      : { status: "skipped", ...themeReport };
    // TEMPLATE DIVERSIFICATION, the report. Evidence only (like donor_cruft):
    // the axes chosen, what pinned them, whether the similarity budget
    // cleared against the donor's prior selections, and what each half of the
    // application actually did to the tree. "skipped" is a real outcome — a
    // donor with no stylesheet keeps its own composition and says so.
    checks.variants = {
      status: variantCssReport.applied ? "passed" : "skipped",
      hero: variantSelection.hero,
      cta: variantSelection.cta,
      type_scale: variantSelection.type_scale,
      section_variants: variantSelection.section_variants,
      section_order: variantSelection.section_order,
      pinned: variantSelection.pinned,
      budget: variantSelection.budget || { enforced: true, rotated: 0, compared: 0 },
      dom: variantDomReport,
      css: variantCssReport,
    };
    // Editorial-cruft strip + watermark hide + mobile toggle reposition. Not a
    // gate (a donor without cruft honestly reports blanked:0); evidence only.
    checks.donor_cruft = { status: "passed", ...cruftReport };
    // Fail closed, for the same reason brand_logo_unreferenced does: a leftover
    // donor icon means the prospect opens a tab wearing another company's mark.
    if (!favicon.report.clean) {
      return err(500, "donor_favicon_residual", [{
        path: "/favicon",
        reason: "donor_icon_survived_the_purge",
        residual_files: favicon.report.residual_donor_icons,
        stray_links: favicon.report.stray_icon_links,
        donor: donorOut.name,
      }]);
    }

    // Every service area published on the shipped tree, measured rather than
    // asserted. `removed_count` is how many of the donor's own towns this build
    // took out; `clean` says none of them survived anywhere a visitor can read.
    checks.area_fence = {
      status: areaFence.report.clean
        ? areaFence.report.removed_count ? "scrubbed" : "passed"
        : "failed",
      ...areaFence.report,
    };
    // Fail closed on VISIBLE residue only. Structured data this pass rewrote is
    // fixed by definition; a town it could not reach is still on the customer's
    // page, and no report may call that clean.
    if (!areaFence.report.clean) {
      return err(500, "donor_area_residual", [{
        path: "/content/areas",
        reason: "a_donor_town_survives_in_visible_copy",
        visible: areaFence.report.visible_residue,
        donor: donorOut.name,
      }]);
    }

    const tok = tokenScan(files);
    checks.token_scan = tok.clean ? { status: "passed" } : { status: "failed", hits: tok.hits };
    if (!tok.clean) return err(500, "unhydrated_tokens", tok.hits);

    // A client logo that was fetched and shipped but is never referenced means
    // the mirror renders SOMEONE ELSE's mark. That is not a downgrade to
    // "unbranded", it is a donor/engine defect, and it is fail-closed for the
    // same reason donor_identity_detected is: the prospect would open a page
    // wearing another company's brand. Never a warning.
    if (brandOut.logo && !logoInDom) {
      return err(500, "brand_logo_unreferenced", [{
        path: "/brand/logo",
        reason: logoRefs === 0
          ? "client_logo_written_but_never_referenced_in_served_markup"
          : !logoBytes ? "client_logo_path_has_no_file_behind_it"
          : "client_logo_bytes_do_not_match_source",
        logo_path: logoPath,
        refs_in_output: logoRefs,
        donor: donorOut.name,
        logo_slots_in_donor: logoSlots,
        sha_in_output: logoShaInOutput,
        sha_source: brandOut.logo.sha256,
      }]);
    }

    // The 108-point optimization stack, audited over the exact bytes the
    // customer receives. This is a SELLABLE claim, so it is measured, never
    // asserted: `met` counts only proven points and the gaps name what the
    // Intake Compiler (intake), BrightData (research) and the authority-page
    // build (content) still owe. Reported, never gating — a mirror with a
    // low score is honest, not blocked.
    checks.content = {
      status: contentReport.sections > 0 ? "injected" : "none",
      ...contentReport,
    };
    checks.optimization_108 = optimization108.score({
      files,
      facts,
      phoneDigits,
      slug,
      manifest: donorOut.manifest,
      photosPlaced,
      heroVideoPlaced,
    });

    // The client rides with the scan (BF-5 + the geo excuse): a place or
    // coordinate the prospect's OWN verified truth carries is not donor
    // residue, and the scan excuses exactly those — everything else stays
    // fatal. fenceAreasServed already receives this same pair.
    const ident = identityScan(files, donorOut.manifest, {
      facts,
      content: publishContent,
    });
    checks.identity_scan = ident.clean ? { status: "passed" } : { status: "failed", hits: ident.hits.slice(0, 10) };
    if (!ident.clean) return err(500, "donor_identity_detected", ident.hits.slice(0, 10));

    // 10c. ROUTES. Every mirror this lane has ever deployed answered 200 to
    //      EVERY path, because deploy.js falls back to a blanket
    //      `/(.*)` -> `/` rewrite whenever the donor declares no spa_routes —
    //      and no usable donor declares any. That single line produced the
    //      soft-404s AND the "8 footer links, 1 page" collision. The route set
    //      is now derived from the bytes being shipped (manifest > compiled
    //      router table > the links the site itself renders), and anything
    //      outside it falls through to a real 404.
    //
    //      404.html was ensured before the exact-tree scans above, including
    //      on content-empty builds, so route derivation can now rely on it.
    let routePlan = routesLib.deriveRoutes({ files, manifest: donorOut.manifest });
    let deadRemoved = 0;
    if (routePlan.dead.length) {
      // A link to nothing is worse than no link. Remove the anchor, and its
      // <li> with it so no empty bullet is left behind, then re-derive so the
      // rewrite list and the audit below both see the repaired tree.
      const pruned = routesLib.pruneDeadLinks(files, routePlan.dead.map((d2) => d2.path));
      for (const [rel, buf] of Object.entries(pruned.files)) files[rel] = buf;
      deadRemoved = pruned.removed;
      const reparse = parseGate(files);
      if (reparse.length) return err(500, "dead_link_prune_broke_markup", reparse.slice(0, 5));
      routePlan = routesLib.deriveRoutes({ files, manifest: donorOut.manifest });
    }
    // A #fragment aimed at an id that is not in the target page's bytes is a
    // promise the page cannot keep. Where the destination is a real shipped
    // file we can settle it here and drop just the fragment — the link still
    // goes somewhere real. SPA routes render their ids at runtime, so those
    // are decided by the rendered audit after deploy, never guessed.
    let hashesStripped = 0;
    const staticMissing = routesLib.staticMissingHashes(files, routePlan.hashTargets);
    if (staticMissing.length) {
      const fixed = routesLib.stripHashes(files, staticMissing);
      for (const [rel, buf] of Object.entries(fixed.files)) files[rel] = buf;
      hashesStripped = fixed.stripped;
      routePlan = routesLib.deriveRoutes({ files, manifest: donorOut.manifest });
    }
    checks.routes = {
      status: routePlan.dead.length ? "failed" : "passed",
      source: routePlan.source,
      spa_routes: routePlan.exact,
      spa_prefixes: routePlan.prefixes,
      linked_paths: routePlan.linked,
      hash_targets: routePlan.hashTargets.length,
      dead_links_removed: deadRemoved,
      dead_hashes_stripped: hashesStripped,
      ...(routePlan.dead.length ? { dead: routePlan.dead.slice(0, 10) } : {}),
      not_found_page: Boolean(files["404.html"]),
      catch_all_rewrite: false,
    };
    if (routePlan.dead.length) {
      return err(500, "dead_internal_links", routePlan.dead.slice(0, 10));
    }
    const spaRoutes = { exact: routePlan.exact, prefixes: routePlan.prefixes };

    // 10d. SAMENESS. "Refuse to publish a mirror whose h1 or title is
    //      byte-identical to another live mirror's" — owner directive after
    //      the 80-mirror audit found 32 sharing one h1 and one served title.
    //
    //      The fleet is assembled from two places, and both are needed. The
    //      registry catches collisions INSIDE one run (a batch builds many
    //      mirrors in a single process, and that is where two businesses in
    //      one city collide). `deps.fleetIdentities` is the durable half — the
    //      mirrors this process has never seen. A caller that supplies neither
    //      still gets every other rule in this check; it simply has nobody to
    //      compare against, and the manifest says so (fleet_compared).
    let fleet = [];
    if (typeof registry.identityAll === "function") fleet = registry.identityAll(slug);
    if (typeof d.fleetIdentities === "function") {
      try {
        const durable = await d.fleetIdentities({ slug, donor: donorOut.name });
        if (Array.isArray(durable)) fleet = fleet.concat(durable);
      } catch (e) {
        // A fleet we could not read is not a fleet with no collisions. Recorded
        // on the check so a pass is never mistaken for a comparison that ran.
        fleet = fleet.concat([]);
        checks.fleet_read_error = String(e.message || e).slice(0, 200);
      }
    }
    const sameness = (renderedH1) => samenessLib.samenessCheck({
      slug,
      facts,
      marketCity: marketCity(facts),
      copy,
      donorFiles,
      files,
      renderedH1,
      fleet,
    });

    // 11. dry_run: manifest + build_hash, zero Vercel calls.
    if (dryRun) {
      checks.asset_diff = { status: "skipped_dry_run" };
      checks.deep_link = { status: "skipped_dry_run" };
      checks.alias_target = { status: "skipped_dry_run" };
      checks.render = { status: "skipped_dry_run" };
      checks.route_render = { status: "skipped_dry_run" };
      // The half of sameness that needs no browser still runs: a donor with no
      // headline slot, or a title that names nobody, is answerable from the
      // bytes — and a dry run is exactly where an operator wants that answer,
      // before any deploy is spent. The rendered-h1 half is honestly absent.
      checks.sameness = sameness(null);
      const manifest = {
        ok: true,
        dry_run: true,
        renderer: RENDERER,
        verification,
        qc_contract: QC_CONTRACT,
        evidence_schema: EVIDENCE_SCHEMA,
        build_hash: hash,
        donor: donorOut.name,
        donor_content_hash: donorHash,
        slug,
        file_count: Object.keys(files).length,
        logo_sha: brandOut.hashes.logo_sha || null,
        checks,
        revealable: false,
      };
      manifest.evidence_sha = signEvidence(manifest);
      return { ok: true, status: 200, body: manifest };
    }

    // 12. Resume or deploy — NO alias mutation yet. READY/alias alone is not
    // trusted: regenerated bytes and deep links must match in the same project.
    let deployed;
    const sharedSelection = sharedPublisherSelection(deps);
    if (sharedSelection.selected) {
      if (sharedSelection.error) {
        return err(503, "shared_publish_failed", [{ reason: sharedSelection.error }]);
      }
      const host = d.aliasHostFor(slug);
      const routeMap = routesLib.buildRouteMap({ files, routePlan });
      let staged;
      try {
        staged = await sharedSelection.publisher.stage({
          slug,
          host,
          files,
          routeMap,
          buildHash: hash,
          operationKey,
          signal,
          deadlineAt,
        });
      } catch (e) {
        if (interrupted() || (e && e.name === "AbortError")) return interruption();
        return err(502, "shared_stage_failed", [{ reason: String(e.message || e).slice(0, 300) }]);
      }
      const normalized = normalizeSharedStage(staged, { host, buildHash: hash });
      if (!normalized.ok) {
        return err(502, "shared_stage_failed", [{ reason: normalized.reason }]);
      }
      deployed = {
        dep: { id: normalized.proofIdentity.release_id, url: host },
        projectId: normalized.proofIdentity.site_id,
        finalFiles: files,
        uploaded: Object.keys(files).length,
        deduped: 0,
        reused: false,
        aliasPresent: false,
        shared: true,
        previewUrl: normalized.previewUrl,
        stagedProofIdentity: normalized.proofIdentity,
        sharedStage: normalized,
        sharedPublisher: sharedSelection.publisher,
        sharedHost: host,
      };
    }
    if (!deployed) try {
      const finalFiles = d.withSpaRewrite(files, spaRoutes);
      const projectId = await d.ensureProject(slug, limits);
      const visualSecret = String(process.env.GHOST_AGENCY_VISUAL_SECRET || "").trim();
      const operationReceipt = String(operationKey || "").trim() && visualSecret
        ? createHmac("sha256", visualSecret).update(String(operationKey)).digest("hex")
        : "";
      // Older injected deploy harnesses replace the whole Vercel seam but do
      // not know about resume. Do not let the production resolver escape that
      // test boundary; production/custom fleet-only deps still resolve.
      const customDeploySeam = ["ensureProject", "uploadFiles", "createDeployment", "waitReady"]
        .some((name) => Object.prototype.hasOwnProperty.call(deps, name));
      const canResolveResume = typeof d.resolveAliasDeployment === "function"
        && (!customDeploySeam || Object.prototype.hasOwnProperty.call(deps, "resolveAliasDeployment"));
      const canResolveTagged = typeof d.resolveTaggedDeployment === "function"
        && (!customDeploySeam || Object.prototype.hasOwnProperty.call(deps, "resolveTaggedDeployment"));
      let resume = canResolveResume
        ? await d.resolveAliasDeployment({ slug, projectId }, limits)
        : null;
      if (resume && resume.refused) {
        return err(502, "vercel_error", [{ reason: `resume_refused:${resume.reason}` }]);
      }
      if (resume && !resume.found && resume.reason !== "alias_not_found") {
        return err(502, "vercel_error", [{ reason: `resume_unavailable:${resume.reason || "unknown"}` }]);
      }
      if (resume && resume.found && resume.projectId !== projectId) {
        return err(502, "vercel_error", [{ reason: "resume_refused:deployment_wrong_project" }]);
      }

      const probeCandidate = async (candidate) => {
        const candidateDiff = await d.byteDiff(candidate.deployment.url, finalFiles, limits);
        const candidateDeep = candidateDiff.clean
          ? await d.deepLinkCheck(candidate.deployment.url, finalFiles, spaRoutes, limits)
          : { clean: false, failures: [{ probe: "resume", reason: "byte_diff_failed" }] };
        const transient = transientProbeFailure(candidateDiff, candidateDeep);
        return { clean: candidateDiff.clean && candidateDeep.clean, diff: candidateDiff, deep: candidateDeep, transient };
      };

      let aliasProbe = null;
      if (resume && resume.found) {
        aliasProbe = await probeCandidate(resume);
        // WHY A RESUME WAS REFUSED. Both resume branches used to fall through
        // silently, so a build that re-uploaded and re-created a PAID
        // deployment on every attempt produced no diagnosable line — the
        // failing filename and reason were in memory and thrown away. Filenames
        // and byte LENGTHS only; no content, no PII.
        logResumeDecision("alias", resume, aliasProbe);
        if (aliasProbe.transient) {
          return err(502, "vercel_error", [{ reason: `resume_probe_retryable:${aliasProbe.transient}` }]);
        }
        if (aliasProbe.clean) {
          deployed = {
            dep: resume.deployment,
            projectId,
            finalFiles,
            uploaded: 0,
            deduped: 0,
            reused: true,
            aliasPresent: resume.source !== "operation_metadata",
            verified: { diff: aliasProbe.diff, deep: aliasProbe.deep },
          };
        }
      }

      // A create can commit at Vercel and then lose its caller before alias.
      // Check its secret-bound receipt after an alias miss OR a deterministic
      // stale-alias mismatch, before spending another upload/create.
      if (!deployed && operationReceipt && canResolveTagged) {
        resume = await d.resolveTaggedDeployment({
          projectId,
          buildHash: hash,
          operationKeyHmacSha256: operationReceipt,
        }, limits);
        if (resume && resume.refused) {
          return err(502, "vercel_error", [{ reason: `resume_refused:${resume.reason}` }]);
        }
        if (resume && !resume.found && resume.reason !== "alias_not_found") {
          return err(502, "vercel_error", [{ reason: `resume_unavailable:${resume.reason || "unknown"}` }]);
        }
        if (resume && resume.found && resume.projectId !== projectId) {
          return err(502, "vercel_error", [{ reason: "resume_refused:deployment_wrong_project" }]);
        }
        if (resume && resume.found) {
          const taggedProbe = await probeCandidate(resume);
          logResumeDecision("tagged", resume, taggedProbe);
          if (taggedProbe.transient) {
            return err(502, "vercel_error", [{ reason: `resume_probe_retryable:${taggedProbe.transient}` }]);
          }
          if (taggedProbe.clean) {
            deployed = {
              dep: resume.deployment,
              projectId,
              finalFiles,
              uploaded: 0,
              deduped: 0,
              reused: true,
              aliasPresent: false,
              verified: { diff: taggedProbe.diff, deep: taggedProbe.deep },
            };
          }
        }
      }
      if (!deployed) {
        const { manifest: uploadManifest, uploaded, deduped } = await d.uploadFiles(finalFiles, limits);
        const metadata = {
          build_hash: hash,
          ...(operationReceipt ? { operation_key_hmac_sha256: operationReceipt } : {}),
        };
        const dep = await d.createDeployment({
          projectName: slug,
          projectId,
          manifest: uploadManifest,
          metadata,
        }, limits);
        await d.waitReady(dep.id, limits);
        deployed = { dep, projectId, finalFiles, uploaded, deduped, reused: false };
      }
    } catch (e) {
      if (interrupted() || (e && e.name === "AbortError")) return interruption();
      return err(502, "vercel_error", [{ reason: String(e.message || e).slice(0, 300) }]);
    }

    // 13. Deployed verification pinned to the deploy_id URL.
    if (interrupted()) return interruption();
    let diff;
    let deep;
    try {
      const preview = deployed.shared
        ? await openSharedPreview(deployed.sharedStage, { host: deployed.sharedHost, ...limits })
        : null;
      if (preview && !preview.ok) {
        return err(502, "shared_preview_failed", [{ reason: preview.reason }]);
      }
      const probeTarget = preview ? preview.origin : deployed.dep.url;
      const probeLimits = preview ? { ...limits, fetchImpl: preview.fetch } : limits;
      diff = deployed.verified
        ? deployed.verified.diff
        : await d.byteDiff(probeTarget, deployed.finalFiles, probeLimits);
      deep = deployed.verified
        ? deployed.verified.deep
        : await d.deepLinkCheck(probeTarget, deployed.finalFiles, spaRoutes, probeLimits);
    } catch (e) {
      if (interrupted() || (e && e.name === "AbortError")) return interruption();
      return err(502, deployed.shared ? "shared_preview_failed" : "vercel_error", [{
        reason: `verification: ${String(e.message || e).slice(0, 260)}`,
      }]);
    }
    checks.asset_diff = diff.clean
      ? { status: "passed", checked: diff.checked }
      : { status: "failed", mismatches: diff.mismatches };
    checks.deep_link = deep.clean ? { status: "passed" } : { status: "failed", failures: deep.failures };
    if (!diff.clean || !deep.clean) {
      // A momentary probe 5xx (429/503/…) against a freshly deployed URL is
      // transient, not a bad build: emit the same retryable 502 shape the
      // resume path uses so the durable worker re-probes the SAME deployment on
      // its next bounded attempt instead of discarding a good build (and its
      // ~$1 deploy). Deterministic mismatches (bytes_differ / did_not_serve* /
      // served_spa_shell / catch_all_shadowed_asset) stay a terminal 500.
      const transient = transientProbeFailure(diff, deep);
      if (transient) {
        return err(502, "vercel_error", [{ reason: `fresh_probe_retryable:${transient}` }]);
      }
      return err(500, "deployed_verification_failed", { asset_diff: checks.asset_diff, deep_link: checks.deep_link });
    }

    // 14. PUBLICATION STAYS STAGED. The deployment URL is private proof input;
    //     neither the legacy alias nor the shared release may become public
    //     until the rendered sameness check below has passed. Publishing here
    //     lets a late failed attempt overwrite a winning retry's alias.
    let alias = deployed.shared
      ? { alias: deployed.previewUrl.replace(/\/+$/, "") }
      : null;
    let aliasCheck = deployed.shared
      ? {
          clean: false,
          staged: true,
          release_id: deployed.stagedProofIdentity.release_id,
          site_id: deployed.stagedProofIdentity.site_id,
          build_hash: deployed.stagedProofIdentity.build_hash,
          via: "shared_release_staged_preview",
        }
      : {
          clean: false,
          staged: true,
          deployment_id: deployed.dep.id,
          via: "legacy_deployment_staged",
        };
    checks.alias_target = { status: "staged", ...aliasCheck };

    // 14c. ARCHIVE THE SOURCE — this is what makes Riley's live voice edit
    //      possible on a Mirror Engine site. lib/site-editor.js reads a site's
    //      file tree back from wss-site-sources/<slug>/, edits it, and
    //      redeploys; without an archive it fails immediately with "no
    //      archived source for site". Only the old forge lane ever archived,
    //      so a mirror built here was un-editable by voice. Best effort and
    //      non-fatal — but reported as a NAMED check, because "call Riley and
    //      she changes your site" must only be promised where it is true.
    const archiveDeployedSource = async () => {
      let result = { status: "not_archived", archived: 0, total: Object.keys(deployed.finalFiles).length };
      try {
        const { archiveSiteSource } = require("../site-source-archive");
      // prune:true — deployed.finalFiles IS the complete tree that just went
      // live, so the archive is reconciled to it. Without this the bucket kept
      // every page any previous build ever wrote, and the editor (which reads
      // the bucket, not the site) then refused to recreate a page the visitor
      // was getting a 404 on. See pruneToDeployed() for the measurement.
        const res = await archiveSiteSource({ siteSlug: slug, files: deployed.finalFiles, prune: true });
        result = {
          status: res && res.ok && res.archived > 0 ? "archived" : "not_archived",
          archived: (res && res.archived) || 0,
          total: (res && res.total) || Object.keys(deployed.finalFiles).length,
          errors: res && Array.isArray(res.errors) ? res.errors.slice(0, 3) : [],
        // Named, not counted: which stale pages the archive gave up, so
        // "where did /privacy go" is answerable from the build record.
          pruned: res && res.pruned ? res.pruned : null,
          bucket: "wss-site-sources",
          voice_edit_note: "Riley can edit this site only while an archive exists; the deploy target must also resolve in lib/site-edit-targets.js",
        };
      } catch (e) {
        result = { status: "not_archived", archived: 0, reason: String(e.message || e).slice(0, 160) };
      }
      return result;
    };
    // The archive is slug-scoped mutable state too. A failed late attempt must
    // not replace the winning site's editable source before it wins public
    // publication, so both serving paths keep it staged for now.
    let editable = {
      status: "not_archived",
      archived: 0,
      total: Object.keys(deployed.finalFiles).length,
      reason: deployed.shared ? "shared_release_not_active" : "legacy_release_not_active",
    };
    checks.editable = editable;

    // 15. Rendered check (test 7) against the private deploy URL. Failure or
    //     unavailability is recorded as polish evidence; truth checks still
    //     decide whether publication may proceed.
    //
    //     LIGHT VERIFICATION skips this browser pass entirely — no chromium is
    //     opened, no preview page is staged for it, and the check records
    //     `skipped_light_verification` so the manifest stays honest about what
    //     was and was not measured.
    if (interrupted()) return interruption();
    if (verification === "light") {
      checks.render = {
        status: "skipped_light_verification",
        reason: "GHOST_AGENCY_LIGHT_VERIFICATION — post-deploy browser render proof skipped by owner directive 2026-09-01",
      };
    } else {
      try {
        const preview = deployed.shared
          ? await openSharedPreview(deployed.sharedStage, { host: deployed.sharedHost, ...limits })
          : null;
        if (preview && !preview.ok) {
          return err(502, "shared_preview_failed", [{ reason: preview.reason }]);
        }
        checks.render = await d.renderCheck(
          preview ? preview.origin : `https://${deployed.dep.url}/`,
          preview ? { ...limits, preparePage: preview.preparePage, expectedLogoPath: logoPath }
            : { ...limits, expectedLogoPath: logoPath },
        );
      } catch (e) {
        if (interrupted() || (e && e.name === "AbortError")) return interruption();
        if (deployed.shared) {
          return err(502, "shared_preview_failed", [{ reason: `render: ${String(e.message || e).slice(0, 260)}` }]);
        }
        throw e;
      }
      if (checks.render.status !== "passed" && checks.render.status !== "failed") {
        checks.render = { ...checks.render, status: checks.render.status === "unavailable" ? "unavailable" : "pending" };
      }
    }

    // 15b. ROUTE + PROSE AUDIT, in the browser, over the paths this mirror
    //      links to. renderCheck loads ONE page — which is how eight footer
    //      links resolving to one identical page, nav anchors aimed at ids that
    //      exist nowhere, and "and ask for the to start the conversation" all
    //      shipped with every gate green. A page that renders is not a page
    //      that reads.
    //      Wave 4: the walked set is the authority report itself — service
    //      pages and per-city chapters included — instead of a hard-coded
    //      four-name regex that silently orphaned every new page type.
    //
    //      LIGHT VERIFICATION skips this deep audit chain entirely — including
    //      the per-channel empty-baseline second renders (verify.js's baseline
    //      page over __WSS_CONTENT__) and the line's parallel/recovery audit
    //      wrapper. The donor-native channel proof that consumed this evidence
    //      is skipped with it (see contentFloorReport), never faked.
    if (verification === "light") {
      checks.route_render = {
        status: "skipped_light_verification",
        reason: "GHOST_AGENCY_LIGHT_VERIFICATION — route/prose render audit and empty-baseline channel proof skipped by owner directive 2026-09-01",
      };
    } else {
      const auditPaths = ["/"].concat(
        routePlan.linked.filter((p) => p !== "/"),
        (contentReport.authority_pages || []).filter((p) => p && p !== "/"),
      );
      let audit;
      try {
        const preview = deployed.shared
          ? await openSharedPreview(deployed.sharedStage, { host: deployed.sharedHost, ...limits })
          : null;
        if (preview && !preview.ok) {
          return err(502, "shared_preview_failed", [{ reason: preview.reason }]);
        }
        audit = await d.renderAudit(preview ? preview.origin : `https://${deployed.dep.url}`, {
          paths: auditPaths,
          hashTargets: routePlan.hashTargets,
          // checks.content counts sections in the FILES. If the file says the
          // client's services/reviews/FAQ shipped, the RENDERED home page has to
          // show them or the mirror is a donor template with a logo on it.
          expectInjectedOn: contentReport.sections > 0 ? ["/"] : [],
          // Native donors must name the exact visible section that consumes each
          // island channel. Form options, marquees and footer echoes cannot stand
          // in for the service cards the visitor was promised.
          contentRenderTargets: donorOut.manifest.content_render_targets || {},
          signal,
          deadlineAt,
          ...(preview ? { preparePage: preview.preparePage } : {}),
        });
      } catch (e) {
        if (interrupted() || (e && e.name === "AbortError")) return interruption();
        if (deployed.shared) {
          return err(502, "shared_preview_failed", [{ reason: `render_audit: ${String(e.message || e).slice(0, 260)}` }]);
        }
        throw e;
      }
      checks.route_render = audit && audit.status
        ? audit
        : { status: "unavailable", reason: "no_audit_result" };
    }

    // 15c. SAMENESS, now with the h1 a real browser produced. renderAudit
    //      records the first heading of every path it walks; "/" is the one
    //      that matters, and reading it from the DOM is the only way to catch
    //      a donor that carries a headline token and paints over it anyway.
    const homePage = (checks.route_render.pages || []).find((p) => p && p.path === "/");
    checks.sameness = sameness(homePage && typeof homePage.h1 === "string" ? homePage.h1 : null);
    // The focused A+ visual gate: a missing hero rung, a broken first-party
    // resource/headline/theme proof, or a split brand identity stops release.
    // Typography taste, page speed, and other polish signals stay non-fatal.
    checks.logo_identity = {
      status: logoInDom && Boolean(logoBytes) && checks.favicon.status !== "failed"
        && checks.render?.logo_identity?.status !== "failed" ? "passed" : "failed",
      identity_kind: brandOut.logo ? "verified_source_logo" : "wss_deterministic_wordmark",
      logo_path: logoPath,
      logo_sha256: logoShaInOutput || null,
      favicon_source: checks.favicon.source || "none",
    };
    checks.critical_visual = {
      status: checks.hero_provenance.status === "passed"
        && checks.logo_identity.status === "passed"
        && (verification === "light" || checks.render.status === "passed") ? "passed" : "failed",
      hero: checks.hero_provenance.status,
      logo: checks.logo_identity.status,
      render: checks.render.status,
      ...(checks.render.theme_modes ? { theme_modes: checks.render.theme_modes.status } : {}),
    };
    if (interrupted()) return interruption();

    // Both publication paths are still private here. Only the truth checks may
    // authorize the alias mutation or the shared CAS. Render and route_render
    // remain polish evidence and do not gate publication.
    const truthBeforePublication = REQUIRED_TRUTH_CHECKS
      .filter((name) => name !== "alias_target")
      .every((name) => checks[name] && checks[name].status === "passed");

    if (deployed.shared) {
      if (truthBeforePublication) {
        let activated;
        try {
          activated = await deployed.sharedPublisher.activate(deployed.sharedStage.receipt, limits);
        } catch (e) {
          if (interrupted() || (e && e.name === "AbortError")) return interruption();
          return err(502, "shared_activation_failed", [{ reason: String(e.message || e).slice(0, 300) }]);
        }
        const normalized = normalizeSharedPublication(activated, {
          host: deployed.sharedHost,
          buildHash: hash,
          stagedProofIdentity: deployed.stagedProofIdentity,
        });
        if (!normalized.ok) {
          return err(502, "shared_activation_failed", [{ reason: normalized.reason }]);
        }
        deployed.previewUrl = normalized.previewUrl;
        deployed.proofIdentity = normalized.proofIdentity;
        deployed.releaseEvidence = {
          ...normalized.releaseEvidence,
          hero_video_path: heroArtifact.path,
          hero_video_sha256: heroArtifact.sha256,
          hero_provenance: heroArtifact.provenance,
        };
        alias = { alias: normalized.previewUrl.replace(/\/+$/, "") };
        aliasCheck = {
          clean: true,
          release_id: normalized.proofIdentity.release_id,
          site_id: normalized.proofIdentity.site_id,
          build_hash: normalized.proofIdentity.build_hash,
          via: "shared_release_cas",
        };
        checks.alias_target = { status: "passed", deployment_id: normalized.proofIdentity.release_id };
        editable = await archiveDeployedSource();
        checks.editable = editable;
      }
    } else if (truthBeforePublication) {
      // Legacy Vercel aliases are mutable. Re-attach even on a resumed deploy:
      // a cached aliasPresent observation can become stale while this worker
      // renders, and only the final target check proves this attempt won.
      try {
        alias = await d.attachAlias({ deployId: deployed.dep.id, projectId: deployed.projectId, slug }, limits);
        aliasCheck = await d.aliasTargetCheck({ slug, deployId: deployed.dep.id }, limits);
      } catch (e) {
        if (interrupted() || (e && e.name === "AbortError")) return interruption();
        return err(502, "vercel_error", [{ reason: `alias_publish: ${String(e.message || e).slice(0, 300)}` }]);
      }
      checks.alias_target = aliasCheck.clean
        ? { status: "passed", deployment_id: deployed.dep.id }
        : { status: "failed", ...aliasCheck };
      if (checks.alias_target.status === "passed") {
        editable = await archiveDeployedSource();
        checks.editable = editable;
      }
    }

    const publicReleaseProven = checks.alias_target.status === "passed";
    if (publicReleaseProven && checks.sameness.status === "passed" && typeof registry.identitySet === "function") {
      // Only a mirror that passed joins the fleet. Registering a failed build
      // would make its duplicate headline the reference every later build is
      // measured against — the defect defining the standard.
      registry.identitySet(slug, samenessLib.identityRow({
        slug, copy, files, renderedH1: checks.sameness.rendered_h1,
      }));
    }
    // Same law for the similarity budget's fleet: only a published mirror's
    // variant selection constrains the next same-donor prospect, so a failed
    // experiment cannot shrink another prospect's catalog.
    if (publicReleaseProven && typeof registry.variantSet === "function") {
      registry.variantSet(donorOut.name, {
        prospectId: slug,
        signature: componentVariants.selectionSignature(variantSelection),
      });
    }

    const manifest = {
      ok: true,
      dry_run: false,
      renderer: RENDERER,
      verification,
      qc_contract: QC_CONTRACT,
      evidence_schema: EVIDENCE_SCHEMA,
      build_hash: hash,
      donor: donorOut.name,
      donor_content_hash: donorHash,
      slug,
      deploy_id: deployed.dep.id,
      deploy_url: deployed.shared
        ? (publicReleaseProven ? deployed.previewUrl.replace(/\/+$/, "") : "")
        : `https://${deployed.dep.url}`,
      preview_url: publicReleaseProven && alias
        ? `${alias.alias.replace(/\/+$/, "")}/`
        : "",
      file_count: Object.keys(deployed.finalFiles).length,
      upload_stats: {
        uploaded: deployed.uploaded,
        deduped: deployed.deduped,
        reused: deployed.reused ? Object.keys(deployed.finalFiles).length : 0,
      },
      deployment_reused: Boolean(deployed.reused),
      ...(deployed.shared && publicReleaseProven ? {
        shared_publish: true,
        proofIdentity: deployed.proofIdentity,
        sharedReleaseEvidence: deployed.releaseEvidence,
      } : deployed.shared ? { shared_staged: true } : {}),
      logo_sha: brandOut.hashes.logo_sha || null,
      checks,
      polish_flags: polishFlags(checks),
      revealable: computeRevealable(checks),
    };
    manifest.evidence_sha = signEvidence(manifest);
    // NEVER MEMOISE A BUILD THAT WAS NEVER LOOKED AT.
    //
    // The memo is an IDEMPOTENCY shortcut: ask for the same build twice, get
    // the same answer without paying for it twice — and a build that FAILED a
    // check still belongs in it, because a dead internal link or an unbranded
    // donor is the same on the second ask as on the first. That contract stays.
    //
    // "unavailable" is not a verdict, though. It is the proof stage reporting
    // that it never ran: chromium did not open, so nothing about this page was
    // measured. Caching that turns one lost /tmp extraction race into a
    // permanent answer for that build_hash — every later attempt on the same
    // warm instance replays `idempotent_replay: true` in milliseconds without
    // opening a browser, and the lead cannot recover until the instance dies.
    //
    // recordSet still holds it, so GET /mirror reports what happened. Only the
    // shortcut is withheld, and only for the one status that means "no answer".
    const neverRendered = ["render", "route_render"]
      .some((name) => checks[name] && checks[name].status === "unavailable");
    if (interrupted()) return interruption();
    if (!neverRendered) registry.memoSet(hash, manifest);
    registry.recordSet(slug, manifest);
    return { ok: true, status: 200, body: manifest };
  });
}

module.exports = {
  mirror,
  buttonInkRuleForSheet,
  computeRevealable,
  // Exported so a refusal report can name the checks that actually block,
  // instead of every check that is not "passed" — three of which never are.
  // REQUIRED_CHECKS stays exported (aliased to the truth set) so existing
  // consumers keep working; the polish set ships beside it.
  REQUIRED_CHECKS: REQUIRED_TRUTH_CHECKS,
  REQUIRED_TRUTH_CHECKS,
  POLISH_CHECKS,
  signEvidence,
  buildTokenValues,
  RENDERER,
  QC_CONTRACT,
  EVIDENCE_SCHEMA,
  // Exported for the local-preview-seam test: pins that the opened preview's
  // local gateway origin is accepted as the canonical host only under the
  // local shared-site environment (shared_preview_identity_mismatch law).
  normalizeOpenedPreview,
  createRegistry,
  // Exported for the visual-polish tests: the cinematic dark-scrim base, the
  // donor editorial-cruft strip, and the last-stylesheet append seam.
  darkenForScrim,
  stripDonorCruft,
  stripForgePlaceholders,
  appendToLastCss,
  fleetPolishInputFiles,
  finalizeHeroArtifact,
  applyHeroTileAspect,
};
