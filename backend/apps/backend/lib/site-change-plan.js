"use strict";
// lib/site-change-plan.js — ONE capability instead of a tool per feature.
//
// =====================================================================
// WHY THIS FILE EXISTS (the measured failure it replaces)
// =====================================================================
// lib/site-editor.js runSiteEdit() asks a model to return EVERY changed file
// IN FULL, wrapped in <file path="...">…</file>. On the live Flint mirror that
// is structurally impossible: index.html is 58,909 bytes, and the call caps
// output at 16,000 tokens. Proven, not theorised — artifacts/brightdata-edit-
// proof/gemini-raw-output.txt is 27,834 characters that stop mid-declaration
// inside a `.google-` selector, with no closing </file>. The `<file …>` regex
// therefore matched nothing and the job died with "editor returned no files"
// (artifacts/brightdata-edit-proof/run-edit-result.json), while the live DOM
// hash was byte-identical before and after (dom-before.json / dom-after.json
// share bodyTextSha256 f70f15f4…). Every generic edit on a real mirror hits
// that ceiling, because the file carrying the nav is always the big one.
//
// The fix is not a bigger max_tokens. It is to stop asking a model for files.
//
// =====================================================================
// THE SHAPE
// =====================================================================
// The model receives the client's own facts, a file listing, and a catalog of
// EXACT anchor strings this backend extracted from the client's own HTML. It
// returns a PLAN: a handful of typed, surgical operations, each a few hundred
// bytes. The backend applies them deterministically to that client's archived
// source, verifies each one actually changed bytes, snapshots what it replaced
// so the next call can undo it, redeploys, and reads the change back off the
// live host.
//
// A plan is small by construction, so the truncation failure above cannot
// recur — not "is unlikely to", cannot: a plan that is cut off is not valid
// JSON and is rejected before anything is touched.
//
// It generalises for the reason the owner named: a request nobody anticipated
// still arrives as text, and lands in the same five verbs. Nobody has to ship
// change_color, resize_logo, add_page, swap_hours as separate tools.
//
// =====================================================================
// THE FOUR SAFETY PROPERTIES, AND WHERE EACH ONE IS ENFORCED
// =====================================================================
// CONFIRM BEFORE APPLY — not here. api/vapi-tools/site-edit.js mints an HMAC
//   token bound to (slug, business name, domain, instruction) on the first
//   call and enqueues NOTHING; only a second call carrying that token reaches
//   this module. Nothing in this file can be reached without it.
//
// SCOPE LIMIT — assertInScope(). Every op names a file, and that name is
//   membership-tested against the exact listing returned by listAll(slug) for
//   THIS client. Not a prefix check, not a "../" filter — a set membership
//   test against real keys. A path the client's own archive does not contain
//   cannot be written, so another client's files, the repo, the environment
//   and the infrastructure are unreachable by construction rather than by
//   sanitisation. The deploy target is resolved from the database by
//   lib/site-edit-targets.js and is never read off the plan.
//
// TRUTH LAW — assertSubstantiated(). Any text an op makes VISIBLE is scanned
//   for claim language and for numbers. A claim survives only if the client's
//   own archive already publishes it. So a rating can be surfaced (llms.txt
//   carries "Rating: 4.9 from 106 reviews"), and "licensed and insured, 20
//   years experience" is refused on a site that never said it. The refusal is
//   a sentence Riley can read out loud.
//
// REVERSIBILITY — snapshot(). Before a single byte is uploaded, the pre-edit
//   bytes of every file the plan touches are written to _undo/<slug>/<jobId>/
//   with a manifest, and _undo/<slug>/latest.json is repointed. "undo" is a
//   plan verb, so "put it back how it was" on the next call is the same code
//   path as any other request.
//
// The snapshots live under a top-level _undo/ prefix, NOT inside <slug>/,
// specifically so listAll(slug) — which is both the editable set and the
// deploy manifest — can never sweep a backup onto the public site.

const { createHash } = require("node:crypto");
const { listAll, download, upload } = require("./site-editor");
const { vercelDeploy } = require("./forge");
// Moving a whole section: parsed and applied deterministically, because a
// byte move is a byte move and no model call makes it safer. See
// lib/section-reorder.js for why static donors can have this and compiled
// ones honestly cannot (yet).
const {
  parseSectionReorder,
  planSectionReorder,
  buildSectionCatalog,
  applySectionReorder,
} = require("./section-reorder");
// The spoken sentence for the compiled-donor case. riley-capabilities has no
// requires, so this edge cannot become a cycle — and the sentence the caller
// hears at the capability layer and the one the executor speaks at apply time
// are the same words because they are the same constant.
const { BIGGER_BUILD_SENTENCE } = require("./riley-capabilities");
// The rendered page has the only vote that matters. See lib/edit-verify.js for
// the job that shipped "Done — it's live on your site now" over a headline that
// never changed colour.
const {
  declaredIntents,
  summarizeVerification,
  sayForVerdict,
  verifyEditLive: defaultVerifyEditLive,
} = require("./edit-verify");
const {
  parseSiteFacts,
  classifyEditKind,
  runSeoPageEdit,
  assertNoInventedClaims,
  insertSitemapEntry,
  insertSubPageNavLink,
  hexToHslTriple,
} = require("./seo-page-edit");
// The service×town GRID: the single-page builder's contract, bounded and
// batched. classifySeoGridRequest splits a plural page request from a
// single-page one; runSeoGridEdit is the executor.
const {
  runSeoGridEdit,
  classifySeoGridRequest,
} = require("./seo-grid");
// The progress meter's write side. Every stamp is a recorded fact — "the run
// entered this phase at this moment" — written onto the job row as it happens,
// which is the only reason lib/edit-progress.js can show a percent that is
// derived rather than invented. A tracker never throws and never exceeds its
// own small write ceiling, so the meter cannot fail or slow the edit.
const { createStageTracker, nullTracker } = require("./edit-progress");
// The hero-video policy constants and the slug/prospect join the Seedance lane
// already shares. Both are read-only here: the set_hero_video verb below
// refuses any clip that does not pass the SAME provenance gates the build lane
// applies before a generated clip may ride a ladder (heroReelBlock in
// lib/mirror-lane-build.js; reelEarnsTheRide in lib/hero-reel-runner.js).
const {
  OPENROUTER_SEEDANCE_PRODUCER,
  isDurableHeroProducer,
} = require("./hero-video-policy");
const { siteSlugFromRow } = require("./site-edit-targets");

const UNDO_PREFIX = "_undo";
const TEXT_EXT = /\.(html?|css|js|json|svg|txt|xml)$/i;
// The compiled output. Read-only for the catalogs, and writable by EXACTLY two
// ops (replace_copy, swap_image's path rewrite) which are each narrower than a
// text edit: one rewrites the inside of a single string literal, the other
// rewrites a URL literal. Nothing else may reach these files — see
// assertBundleInScope().
const BUNDLE_EXT = /^assets\/.+\.(js|css)$/i;
const PLAN_MAX_OPS = 6;

/**
 * The rendered check's own ceiling, well inside edit-job-runner's 240s for the
 * whole job. Overrunning it yields an honest "could not confirm" rather than a
 * job that dies with no ending — which is what happened the first time this ran
 * in production (edit_1786238532612_igujov: chromium's cold start ran in series
 * behind the deploy and the two together passed 240s).
 */
const VERIFY_DEADLINE_MS = 70_000;

// ---------------------------------------------------------------------------
// Anchor catalog — why the model never writes an anchor string
// ---------------------------------------------------------------------------
// An op like "insert after the reviews heading" needs an exact substring of the
// client's HTML. If the model supplies that substring it will eventually
// supply one that is close but not exact, and the apply step will either miss
// or — worse, if we were fuzzy about it — hit the wrong place. So the backend
// extracts the real strings, hands the model a numbered catalog, and the plan
// selects an id. The model chooses WHERE; it never spells the anchor. An id
// that is not in the catalog is rejected outright.
function buildAnchorCatalog(fileTexts) {
  const anchors = [];
  let n = 0;
  for (const [rel, text] of Object.entries(fileTexts)) {
    if (!/\.html?$/i.test(rel)) continue;
    const body = String(text).replace(/<script[\s\S]*?<\/script>/gi, (m) => " ".repeat(m.length));
    for (const m of body.matchAll(/<(h[1-4])\b[^>]*>([\s\S]{0,180}?)<\/\1>/gi)) {
      const exact = m[0];
      // Ambiguous anchors are dropped, not disambiguated. Two identical
      // headings mean "insert after the heading" has two answers, and picking
      // one is exactly the guess this system must never make.
      if (body.split(exact).length - 1 !== 1) continue;
      const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!label) continue;
      n += 1;
      anchors.push({ id: `a${n}`, file: rel, kind: m[1].toLowerCase(), label, exact });
    }
  }
  return anchors;
}

// ---------------------------------------------------------------------------
// Element catalog — why the model is told what is ON the page
// ---------------------------------------------------------------------------
// These mirrors are compiled single-page apps: index.html's <body> is nearly
// empty and the header, logo, hero and buttons exist only after the JS runs.
// The anchor catalog above therefore sees none of them — and a planner that
// has never been told a logo exists refuses "Cannot identify logo element",
// which is exactly what it did on the owner's live call (019fd91d, asked to
// enlarge and move the logo; and again for "a more colorful hero image").
// The caller was right to be frustrated: the elements are ALWAYS there.
//
// They are always there because the ENGINE puts them there. Every mirror
// serves its mark at /assets/client-logo.* (lib/mirror-engine/engine.js
// logoPath), renders phone CTAs as tel: anchors, and ships the hero as the
// first full-bleed section. Those are conventions of our own build, not
// donor accidents — so the selectors below are runtime-stable on every site
// this module is allowed to touch. Each is DETECTED in the shipped bundle
// before it is offered, so a donor that genuinely lacks one never advertises
// it. Verified against the live Rimrock DOM before writing this catalog:
// img[src*="client-logo"] inside header, a[href^="tel:"] ×4, section#top
// carrying both a <video> and imagery.
// `scanText` MUST include the compiled JS bundle under assets/. index.html on
// these mirrors is a shell — fetching it raw shows no <header>, no logo <img>
// and no hero. Everything the caller can see is created by the bundle at
// runtime, so a catalog built from the editable text files alone finds almost
// nothing, which is how the planner ended up inventing `header a[href="/"]`
// for the logo link. That selector matches ZERO elements on the live page (the
// anchor is href="#top"), so the "move the logo right" edit would have applied
// cleanly, reported success, and changed nothing a customer could see.
//
// The bundle is scanned READ-ONLY and is never added to the editable set.
function buildElementCatalog(fileTexts, scanText = "") {
  const all = `${Object.values(fileTexts).map(String).join("\n")}\n${String(scanText)}`;
  const out = [];
  // Each offer carries the literal bundle substring that PROVED the element is
  // there. That string is the warrant for the selector: the catalog is the only
  // source of selectors a plan may use (validateOverrideCss enforces it), so
  // "this selector matches something on the served page" reduces to "this
  // evidence was found in the bytes we are about to deploy". Recorded on the
  // job so a reviewer can audit why an element was believed to exist rather
  // than taking the planner's word for it.
  const offer = (probe, selector, note) => {
    const m = all.match(probe);
    if (!m) return;
    out.push({ id: `e${out.length + 1}`, selector, note, evidence: String(m[0]).slice(0, 80) });
  };
  const LOGO = /client-logo|brand-logo/;
  const TOP = /id:\s*["']top["']|id=["']top["']|["']#top["']/;

  // RESIZE THIS WITH height, NEVER WITH transform. A live call asked for a
  // bigger logo, the planner answered `transform: scale(2.5)`, and the mark
  // ended up hanging 17px off the left edge of the header at every width:
  // transform moves PAINT and leaves the layout box the size it always was, so
  // the header reserves the old width and centres the enlarged mark on it. The
  // donor is now served at 2x, which multiplied that request to an effective
  // 5x. height (with max-width to keep it from crowding the call button) grows
  // the box and the picture together, so the row simply re-flows around it.
  offer(LOGO, 'header img[src*="client-logo"], header img[src*="brand-logo"]',
    "the client's logo image in the header bar. To resize it use height (e.g. height:96px) plus max-width:100% — NOT transform:scale(), which enlarges the picture without enlarging the space it occupies and pushes the logo off the edge of the header");
  // :has() rather than an href guess. The wrapper's href differs per donor
  // (Rimrock's is "#top", not "/"), and the planner cannot see the markup to
  // know that — so give it a selector that is true whatever the href is.
  offer(LOGO, 'header a:has(img[src*="client-logo"]), header a:has(img[src*="brand-logo"])',
    "the clickable wrapper AROUND the logo — move/reposition THIS, not the img");
  offer(/<header|["']header["']/, "header",
    "the fixed top bar");
  // The header's inner FLEX ROW — the thing you actually reorder when a caller
  // says "swap the logo and the call button". Verified against the live Rimrock
  // DOM: this matches exactly 1 element (display:flex), where the looser
  // `header div:has(img…)` matches 2 and the outer one is not the flex row.
  // Note the child combinator inside :has() — `:has(:has(…))` is INVALID CSS
  // and throws in querySelectorAll, so it must stay a single flat :has.
  offer(LOGO, 'header div:has(> a > img[src*="client-logo"]), header div:has(> a > img[src*="brand-logo"])',
    "the header's FLEX ROW holding the logo and the call button. Reorder its children here: flex-direction:row-reverse, or `order:` on the child selectors below. Use this for any 'swap'/'move to the other side' request");
  offer(/tel:/, 'header a[href^="tel:"]',
    "the phone number and call button IN the header");
  offer(/tel:/, 'a[href^="tel:"]',
    "every phone link on the page, header and body");
  offer(TOP, "section#top",
    "the hero — the first full-height section. Backgrounds, filters, padding and layout belong HERE. Text colour and text size do NOT: see the headline and heading entries below");
  offer(TOP, "section#top video, section#top img",
    "the hero's existing video and imagery — filter/saturate/brightness these to recolour the hero");

  // -------------------------------------------------------------------------
  // THE WORDS THEMSELVES — the entries whose absence produced a lie
  // -------------------------------------------------------------------------
  // Until these existed the catalog offered containers and nothing else, so
  // "make the main headline text bright orange" had no honest target and the
  // planner reached for the nearest thing it had been shown: section#top. The
  // rule applied, the section's own colour changed, and the h1 kept the colour
  // its `text-bone` utility gives it — inheritance only ever supplies a value to
  // a descendant that has none of its own. The customer was told it was live.
  //
  // Measured in Chromium on the live mirror, injecting each rule and reading the
  // h1's computed colour back:
  //     section#top { color:#ff6600 }   -> h1 unchanged
  //     h1          { color:#ff6600 }   -> h1 rgb(255,102,0)
  // A BARE ELEMENT SELECTOR IS ENOUGH. These builds compile their utilities into
  // `@layer utilities`, and applyStyleOverride writes an UNLAYERED <style> block,
  // which outranks any layered declaration at any specificity. So there is no
  // specificity war to win and no reason to reach for !important — the only
  // thing that ever has to be right is WHICH ELEMENT the rule names.
  offer(/["']h1["']|<h1[\s>]/i, "h1",
    "THE MAIN HEADLINE — the single biggest line of text on the page, at the top. "
    + "Every request about the headline's colour, size, weight, font or casing targets THIS. "
    + "Never style the headline by styling the section around it: colour and font are inherited "
    + "properties, and the headline carries its own utility class, so a rule on the hero changes "
    + "the hero and leaves the headline exactly as it was");
  offer(/["']h2["']|<h2[\s>]/i, "h2",
    "the big section headings further down the page (the line that introduces each block)");
  offer(/["']h3["']|<h3[\s>]/i, "h3",
    "the smaller sub-headings inside sections — service names, card titles");
  offer(/["']h[123]["']|<h[123][\s>]/i, "h1, h2, h3",
    "every heading on the page at once. Use this for 'make all the headings …'");
  offer(/["']p["']|<p[\s>]/i, "p",
    "the body paragraphs — the ordinary sentences under the headings");
  return out;
}

// ---------------------------------------------------------------------------
// Asset catalog — what this site can be re-dressed WITH
// ---------------------------------------------------------------------------
// The second refusal on call 019fd91d was "Cannot select image": the caller
// asked for a more colorful hero and was told to email a file. The site was
// already serving three photographs and a video at the time. The planner had
// simply never been shown them.
//
// So it gets a catalog of the media the site ALREADY SHIPS, and — this is the
// load-bearing half — it may reference nothing else. validateOverrideCss()
// rejects any url() that is not one of these paths, which closes the door on
// http(s) fetches, protocol-relative URLs and data: blobs alike. That is the
// APOC rule expressed as code rather than as a warning in a prompt: a plan
// physically cannot put another company's picture on a customer's site.
//
// PROVENANCE — the honest label. It is tempting to describe these as "the
// client's own photographs", and for a site whose photo slots were filled by
// the harvester that is true. It was NOT true of Rimrock: all three JPGs and
// the hero video are byte-identical to donors-clean/plumbing-clean/assets
// (sha256 31c78c22…, 8e5bddcf…, 92ac66c4…, 0572912e…), i.e. our own template
// imagery, while only client-logo.png is unique to the client. The archive
// alone cannot tell the two apart, so the catalog claims only what it can
// prove: these are files THIS SITE SERVES. Calling template stock "your
// photos" to a customer would be a fresh truth-law breach of exactly the
// species that shipped a manufacturer's badge as a client logo.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

/**
 * Intrinsic dimensions straight out of the file header — no decode, no
 * dependency, a few bytes read. A format we cannot read yields null rather
 * than a guess, and never fails the job.
 */
function imageSize(buf, rel) {
  try {
    if (!buf || buf.length < 16) return null;
    if (/\.png$/i.test(rel) && buf.readUInt32BE(0) === 0x89504e47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (/\.gif$/i.test(rel)) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (/\.jpe?g$/i.test(rel)) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        // SOF0-SOF15 carry the frame size; C4/C8/CC are tables, not frames.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        const len = buf.readUInt16BE(i + 2);
        if (len < 2) return null;
        i += 2 + len;
      }
      return null;
    }
    if (/\.webp$/i.test(rel) && buf.length > 30 && buf.toString("ascii", 8, 12) === "WEBP") {
      const fmt = buf.toString("ascii", 12, 16);
      if (fmt === "VP8X") return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
      if (fmt === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    if (/\.svg$/i.test(rel)) {
      const head = buf.toString("utf8", 0, 2000);
      const vb = head.match(/viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
      if (vb) return { w: Math.round(Number(vb[1])), h: Math.round(Number(vb[2])) };
    }
  } catch {
    /* A malformed header is a missing dimension, never a failed edit. */
  }
  return null;
}

/**
 * "hero-detail-fitting-CjWkqcPK.jpg" -> "hero detail fitting".
 *
 * The trailing segment is Vite's content hash. It is stripped only when it
 * looks like one — 8 chars carrying mixed case, a digit or an underscore — so
 * an honest all-lowercase word ("our-bathroom") survives intact.
 */
function assetLabel(rel) {
  const base = String(rel).split("/").pop().replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/-([A-Za-z0-9_-]{8})$/, (m, seg) =>
    /[A-Z]/.test(seg) && /[a-z0-9_]/.test(seg) ? "" : m);
  return (cleaned || base).replace(/[-_]+/g, " ").trim();
}

/**
 * buildAssetCatalog(files, scanText)
 * -> [{ id, path, kind, label, bytes, width, height, orientation, onPage }]
 *
 * `files` is the client's own archive (rel -> Buffer). `scanText` is the
 * compiled bundle, read-only, used to mark which media the page actually
 * renders — an asset nobody references is still offerable, but the planner
 * should prefer one already in the layout.
 */
function buildAssetCatalog(files, scanText = "") {
  const out = [];
  for (const rel of Object.keys(files || {}).sort()) {
    if (!rel.startsWith("assets/")) continue;
    const isImage = IMAGE_EXT.test(rel);
    const isVideo = VIDEO_EXT.test(rel);
    if (!isImage && !isVideo) continue;
    const buf = files[rel];
    const size = isImage ? imageSize(buf, rel) : null;
    const path = `/${rel}`;
    out.push({
      id: `m${out.length + 1}`,
      path,
      kind: /client-logo|brand-logo/i.test(rel) ? "logo" : isVideo ? "video" : "photo",
      label: assetLabel(rel),
      bytes: buf ? buf.length : 0,
      width: size ? size.w : null,
      height: size ? size.h : null,
      orientation: size
        ? (size.w > size.h * 1.2 ? "landscape" : size.h > size.w * 1.2 ? "portrait" : "square")
        : null,
      onPage: String(scanText).includes(path),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSS validation — the no-op that reported success
// ---------------------------------------------------------------------------
// Re-run of call 019fd91d's two requests against the live planner, with the
// element catalog in place, produced these three payloads:
//
//   "filter: saturate(1.5) !important;"          ("more colorful hero")
//   "transform: scale(1.2) !important;"          ("bigger logo")   <- ALSO WRONG
//                                                    on its own merits, see
//                                                    LOGO_SELECTOR below
//   "margin-left: auto !important;"              ("move it right")
//   "flex-direction: row-reverse !important;"    ("swap logo and phone")
//
// Every one is a bare DECLARATION with no selector. Dropped into a <style>
// block each parses to ZERO rules — measured in Chromium, not reasoned about:
// style.sheet.cssRules.length === 0 for all four, and 1 for the same
// declarations wrapped in `section#top video { … }`. So the caller would have
// been told "Done — it's live on your site now" for a change that styled
// nothing at all. The existing byte-change guarantee cannot catch this: the
// <style> block itself adds bytes, so index.html genuinely changed.
//
// That is the same lie as the refusal, wearing a smile. These functions make
// it impossible:
//   - CSS carrying no complete rule is rejected outright;
//   - every selector must be one the ELEMENT CATALOG offered, and each catalog
//     entry was detected in the bundle being deployed, so a selector that
//     matches nothing on the served page cannot reach the page;
//   - every url() must name a file this site already ships.
function stripCssComments(css) {
  return String(css || "").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Split on `ch` only at paren depth 0, so `:has(a, b)` stays in one piece. */
function splitTopLevel(text, ch) {
  const out = [];
  let depth = 0;
  let buf = "";
  for (const c of String(text)) {
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (c === ch && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += c;
  }
  out.push(buf);
  return out;
}

/**
 * parseCssRules(css) -> { rules: [{selector, declarations}], problems: [str] }
 *
 * `problems` collects anything outside a selector block — which is exactly the
 * bare-declaration failure above — plus at-rules other than @media.
 */
function parseCssRules(css) {
  const src = stripCssComments(css);
  const rules = [];
  const problems = [];
  let i = 0;
  while (i < src.length) {
    const brace = src.indexOf("{", i);
    if (brace < 0) {
      const tail = src.slice(i).trim();
      if (tail) problems.push(tail);
      break;
    }
    const prelude = src.slice(i, brace).trim();
    let depth = 0;
    let end = -1;
    for (let j = brace; j < src.length; j += 1) {
      if (src[j] === "{") depth += 1;
      else if (src[j] === "}") { depth -= 1; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) { problems.push(prelude || "unclosed block"); break; }
    const body = src.slice(brace + 1, end);
    if (prelude.startsWith("@")) {
      // A responsive tweak is legitimate; everything else that can load or
      // redefine resources (@import, @font-face, @supports…) is not.
      if (/^@media\b/i.test(prelude)) {
        const inner = parseCssRules(body);
        rules.push(...inner.rules);
        problems.push(...inner.problems);
      } else {
        problems.push(prelude);
      }
    } else if (prelude) {
      rules.push({ selector: prelude, declarations: body.trim() });
    } else {
      problems.push("a block with no selector");
    }
    i = end + 1;
  }
  return { rules, problems };
}

const normalizeSelector = (s) => String(s).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// The scaled logo — a rule that applies cleanly and still looks broken
// ---------------------------------------------------------------------------
// Every selector the catalog offers for the logo carries the filename that
// proved it exists, so "is this rule aimed at the logo" is a substring test on
// the selector rather than a guess about intent.
const LOGO_SELECTOR = /client-logo|brand-logo/;

// `transform: scale()` and the standalone `scale:` property both resize the
// PAINTED image and leave the element's layout box exactly as it was. On the
// logo that is not a cosmetic difference: the header reserves the original
// width, the enlarged mark is centred on it, and it overhangs — measured at 17px
// off the left edge at every viewport width on a live call, compounded to an
// effective 5x by the donor already being served at 2x.
//
// Deliberately narrow. `transform: translateX(...)` to nudge the logo across is
// fine and stays allowed; only the scaling forms are refused, and only on the
// logo, where the overhang is what a stranger sees first.
const SCALE_TRANSFORM = /(?:^|[;{}]|\s)(?:-webkit-|-moz-|-ms-|-o-)?transform\s*:[^;}]*\bscale(?:X|Y|Z|3d)?\s*\(/i;
const SCALE_PROPERTY = /(?:^|[;{}]|\s)scale\s*:\s*[^;}]+/i;

const scalesInPlace = (declarations) => SCALE_TRANSFORM.test(String(declarations))
  || SCALE_PROPERTY.test(String(declarations));

/** Every selector the catalog offers, plus each comma-branch of one. */
function allowedSelectorSet(elements) {
  const set = new Set();
  for (const el of elements || []) {
    set.add(normalizeSelector(el.selector));
    for (const branch of splitTopLevel(el.selector, ",")) {
      const b = normalizeSelector(branch);
      if (b) set.add(b);
    }
  }
  return set;
}

/**
 * validateOverrideCss(css, { elements, assets })
 * -> { rules, selectors }   throws with a caller-readable reason otherwise.
 */
function validateOverrideCss(css, { elements = [], assets = [] } = {}) {
  const text = String(css || "").trim();
  if (!text) throw new Error("style_override: empty css");
  if (/@import/i.test(text)) {
    throw new Error("style_override: refuses to pull in a third-party stylesheet or asset");
  }
  const { rules, problems } = parseCssRules(text);
  const atRule = problems.find((p) => String(p).startsWith("@"));
  if (atRule) {
    // @media is parsed through; anything else can load a resource or redefine
    // the page's typography, neither of which is a customer's styling request.
    throw new Error(`style_override: '${String(atRule).split("{")[0].trim().slice(0, 60)}' is not allowed — only @media may wrap rules`);
  }
  if (!rules.length) {
    throw new Error(
      `style_override: no complete CSS rule — ${JSON.stringify(text.slice(0, 80))} is a bare ` +
      "declaration with no selector, which styles nothing on the page"
    );
  }
  if (problems.length) {
    throw new Error(`style_override: ${JSON.stringify(String(problems[0]).slice(0, 80))} is not inside a selector block`);
  }

  const allowed = allowedSelectorSet(elements);
  const selectors = [];
  for (const rule of rules) {
    if (!rule.declarations.trim()) {
      throw new Error(`style_override: rule '${normalizeSelector(rule.selector)}' declares nothing`);
    }
    for (const part of splitTopLevel(rule.selector, ",")) {
      const sel = normalizeSelector(part);
      if (!sel) continue;
      if (!allowed.has(sel)) {
        throw new Error(
          `style_override: selector '${sel}' is not one of this site's PAGE ELEMENTS, ` +
          "so it would match nothing on the served page"
        );
      }
      if (LOGO_SELECTOR.test(sel) && scalesInPlace(rule.declarations)) {
        throw spokenRefusal(
          "style_override: refusing transform/scale on the logo — it enlarges the painted mark "
          + "without enlarging its layout box, so the logo overhangs the header. "
          + `Resize '${sel}' with height (e.g. height: 96px) and max-width: 100% instead.`,
          "I can make the logo bigger — I just need to do it by its height rather than by "
          + "stretching it, otherwise it hangs off the edge of the header. Let me set it that way.",
        );
      }
      selectors.push(sel);
    }
  }

  // Imagery may only be this client's own shipped files. Blocks https:, //host,
  // and data: blobs in one membership test rather than a denylist.
  const shipped = new Set((assets || []).map((a) => a.path));
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    const ref = String(m[2]).trim();
    if (!shipped.has(ref)) {
      throw new Error(
        `style_override: '${ref.slice(0, 80)}' is not one of this site's own files — ` +
        "refusing to put outside imagery on a customer's page"
      );
    }
  }
  return { rules, selectors };
}

/**
 * A plan may target an element by catalog id and supply only declarations —
 * the same discipline the anchor catalog already enforces for text. The model
 * chooses WHICH element; the backend spells the selector. Raw `css` is still
 * accepted, and validated identically, so nothing that worked stops working.
 */
function composeOverrideCss(op, elements = []) {
  const target = String(op.target || "").trim();
  if (!target) return String(op.css || "").trim();
  const el = (elements || []).find((e) => e.id === target);
  if (!el) throw new Error(`style_override: '${target}' is not one of this site's element ids`);
  let decls = String(op.declarations == null ? op.css || "" : op.declarations).trim();
  // Strip a wrapping "{ … }" ONLY when the whole value is one — the old
  // unconditional strip also ate the closing brace of a complete RULE
  // ("header img { … }" -> "header img { …"), leaving it unbalanced and
  // unrecognisable to the unwrap below.
  if (decls.startsWith("{") && decls.endsWith("}")) decls = decls.slice(1, -1).trim();
  if (!decls) throw new Error("style_override: empty declarations");

  // BE LIBERAL ABOUT A REDUNDANT SELECTOR. Asked for a bigger logo with a
  // shimmer, the planner returned a COMPLETE rule — "header img { height:
  // 96px; }" — in the `declarations` field, having already named the element in
  // `target`. That is the model being redundant, not wrong: it knows the
  // element, it said so twice. Refusing it failed the owner's live call
  // ("style_override: declarations must not contain a selector block") for an
  // edit whose intent was unambiguous.
  //
  // NOTE what changed since this was written: the declaration on that call was
  // "transform: scale(2.5)", and unwrapping it here is what put a logo hanging
  // off the edge of the header on every live mirror. The redundant-selector
  // leniency below is still right — the SHAPE was never the problem. The
  // scaling itself is now refused outright in validateOverrideCss, and the
  // logo's catalog entry steers the resize to height/max-width, so the same
  // call today unwraps a rule that actually re-flows the header.
  //
  // So unwrap a single leading selector when it addresses the SAME element we
  // already resolved, and keep refusing anything else — a rule aimed somewhere
  // other than `target` is a real disagreement about what to change, and
  // guessing which one the caller meant is exactly the silent-wrong-edit this
  // module exists to prevent. Multi-rule blocks stay refused too: `target`
  // names one element, and a plan that wants several should say so as several
  // ops that each get validated.
  if (decls.includes("{")) {
    const single = /^([^{}]+)\{([^{}]*)\}$/.exec(decls);
    // Match any COMMA-BRANCH of the element's selector, not just the whole
    // thing. The logo is offered as a pair ('header img[src*="client-logo"],
    // header img[src*="brand-logo"]') and a model that echoes one branch —
    // the branch that matches this client's actual file — is naming the same
    // element, not a different one. Comparing against the full string refused
    // it, which is the very failure the paragraph above set out to fix.
    // Branches of OTHER elements are still absent from this set, so a rule
    // aimed somewhere else is still a real disagreement and still refused.
    const sameElement = single && allowedSelectorSet([el]).has(normalizeSelector(single[1]));
    if (!sameElement) {
      throw new Error("style_override: declarations must not contain a selector block");
    }
    decls = single[2].trim();
    if (!decls) throw new Error("style_override: empty declarations");
  }
  return `${el.selector} { ${decls.replace(/;\s*$/, "")}; }`;
}

// ===========================================================================
// THE STRETCHED LOGO — a rule that applies, verifies, and looks broken
// ===========================================================================
// From the same live call as the vanishing logo, minutes later: "the logo is
// now stretched and cut off and cropped", then "the box it's sitting in is now
// too small". Both are real, both are mechanical, and neither is something the
// planner can be trusted to remember every time.
//
//   STRETCHED. `width: 200px; height: 80px` on a raster whose intrinsic ratio
//   is anything else distorts it. An image has ONE degree of freedom if it is
//   to stay itself: set one axis and let the other follow. So when a rule aimed
//   at the logo IMAGE sets both, width becomes `auto` — height is the axis a
//   header cares about — and the mark keeps its shape.
//
//   CUT OFF / CROPPED. Even sized on one axis, an <img> whose box is smaller
//   than its content clips unless it is told otherwise. `object-fit: contain`
//   is the whole fix, and `max-width: 100%` is what stops a wide mark spilling
//   past its column on a phone.
//
//   THE TEMPLATE'S OWN CEILING. Several donors ship the mark as
//   `h-auto max-h-20` — an 80px max-height utility that silently caps any
//   height the resize declares, which reads to the caller as "still not
//   fitting" and to the rendered check as "did not land" (see the long note at
//   the max-height companion below). A size change lifts it; a planner's own
//   max-height is never overruled.
//
//   THE BOX IS TOO SMALL. This is the one the caller had to ask for as a
//   SECOND edit, which is the tell that the first one was incomplete. Growing
//   the logo to 96px inside a header that reserves 64px and clips it is not a
//   change anybody wanted — the picture is bigger and less of it is visible.
//   So a rule that raises the logo's height also carries its container: the
//   wrapper is allowed to grow around it, and the header gets a min-height
//   with room to breathe.
//
// COMPANIONS ARE NOT A REDESIGN. They are emitted only when the customer asked
// for a size change on the logo, only against selectors the ELEMENT CATALOG
// already offered (so validateOverrideCss still governs every one of them),
// and never when the plan already spoke about that element itself — a planner
// that set the header's height deliberately is not overruled here.
const LENGTH_VALUE = /^-?\d*\.?\d+(px|r?em|vh|vw|ch|ex|cm|mm|in|pt|pc|%)$/i;
const KEYWORD_VALUE = /^(auto|inherit|initial|unset|revert|none|fit-content|min-content|max-content)$/i;
const LOGO_IMG_SELECTOR = /(^|[\s>+~])img\b|\bimg[[.:#]/i;

/** Declarations as an ordered, editable list. `!important` is preserved. */
function parseDeclarations(text) {
  const out = [];
  for (const chunk of splitTopLevel(String(text || ""), ";")) {
    const raw = chunk.trim();
    if (!raw) continue;
    const at = raw.indexOf(":");
    if (at <= 0) continue;
    const property = raw.slice(0, at).trim().toLowerCase();
    let value = raw.slice(at + 1).trim();
    let important = false;
    if (/!\s*important$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important$/i, "").trim();
    }
    if (!property || !value) continue;
    out.push({ property, value, important });
  }
  return out;
}

function serializeDeclarations(decls) {
  return decls.map((d) => `${d.property}: ${d.value}${d.important ? " !important" : ""};`).join(" ");
}

/**
 * normalizeLogoSizing(css, elements) -> { css, notes }
 *
 * Pure string -> string. `notes` is recorded on the job so a reviewer can see
 * exactly what was added on the customer's behalf and why, rather than finding
 * declarations in the deployed page that nothing in the plan asked for.
 */
function normalizeLogoSizing(css, elements = []) {
  const parsed = parseCssRules(String(css || ""));
  if (!parsed.rules.length || parsed.problems.length) return { css: String(css || ""), notes: [] };

  const notes = [];
  const rendered = [];
  const spokenFor = new Set();
  let logoHeightPx = 0;

  for (const rule of parsed.rules) {
    const branches = splitTopLevel(rule.selector, ",").map(normalizeSelector).filter(Boolean);
    for (const b of branches) spokenFor.add(b);
    const targetsLogoImage = branches.some((b) => LOGO_SELECTOR.test(b) && LOGO_IMG_SELECTOR.test(b));
    if (!targetsLogoImage) {
      rendered.push(`${normalizeSelector(rule.selector)} { ${rule.declarations.trim()} }`);
      continue;
    }

    const decls = parseDeclarations(rule.declarations);
    const find = (p) => decls.find((d) => d.property === p);
    const sized = (d) => Boolean(d) && !KEYWORD_VALUE.test(d.value);
    const width = find("width");
    const height = find("height");

    // ONE AXIS. Both axes pinned is the definition of a stretched raster.
    if (sized(width) && sized(height)) {
      width.value = "auto";
      notes.push("width_set_to_auto_so_the_logo_keeps_its_shape");
    }

    const touchesSize = sized(width) || sized(height) || find("max-height") || find("max-width");
    if (touchesSize) {
      if (sized(width) && !height) {
        decls.push({ property: "height", value: "auto", important: true });
        notes.push("height_auto_added_so_the_logo_keeps_its_shape");
      }
      // THE DONOR'S HEIGHT CEILING CANNOT SILENTLY EAT THE RESIZE.
      //
      // Field reports, 2026-08-17: Air Creation called five times for one
      // bigger logo and kept hearing "still not fitting correctly" and "the
      // logo keeps going back". The mechanism, measured off the shipped donor
      // bundles: several donors render the mark as
      // `h-auto max-h-20 w-auto max-w-[240px] object-contain` — the logo img
      // carries an 80px MAX-HEIGHT from the template's own utility classes.
      // A resize rule that says `height: 96px` wins the height declaration
      // (unlayered beats the layered utility) but says nothing about
      // max-height, so the used height computes to min(96, 80) = 80px. Three
      // things break at once: the caller sees a logo that did not grow
      // ("still not fitting"), the rendered check reads 80px against a
      // declared 96px and fails ("did not land"), and the rollback restores
      // the pre-edit bytes ("the logo went back") — one template clamp
      // producing all three sentences the owner heard.
      //
      // So a size change on the logo img LIFTS the ceiling, exactly as the
      // width companion below lifts the donor's max-w-[240px]. A rule that
      // sets max-height ITSELF is a planner deliberately shrinking the mark —
      // that intent is never overruled.
      if (!find("max-height")) {
        decls.push({ property: "max-height", value: "none", important: true });
        notes.push("max_height_lifted_so_the_template_clamp_cannot_eat_the_resize");
      }
      if (!find("object-fit")) {
        decls.push({ property: "object-fit", value: "contain", important: true });
        notes.push("object_fit_contain_added_so_the_logo_is_not_cropped");
      }
      if (!find("max-width")) {
        decls.push({ property: "max-width", value: "100%", important: true });
        notes.push("max_width_100_added_so_the_logo_fits_its_container");
      }
    }

    // THE AXIS THE HEADER CARES ABOUT, IN PIXELS. px is spoken as itself; rem
    // is resolved at 16 — the donor root font-size — because the header
    // min-height companion below has to add pixels to pixels. `height: 6rem`
    // used to be invisible to it, so a planner that said rem shipped a bigger
    // logo into a box that never heard about it.
    const h = find("height");
    if (h && LENGTH_VALUE.test(h.value)) {
      const px = /^-?\d*\.?\d+px$/i.test(h.value)
        ? parseFloat(h.value)
        : /^-?\d*\.?\d+rem$/i.test(h.value)
          ? parseFloat(h.value) * 16
          : 0;
      logoHeightPx = Math.max(logoHeightPx, px);
    }
    rendered.push(`${normalizeSelector(rule.selector)} { ${serializeDeclarations(decls)} }`);
  }

  // THE CONTAINER. Only when the logo actually got taller, only for elements
  // the catalog offered, and only where the plan said nothing itself.
  if (logoHeightPx > 0) {
    const offered = (predicate) => (elements || []).find((e) => predicate(normalizeSelector(e.selector)));
    const untouched = (selector) => {
      const norm = normalizeSelector(selector);
      if (spokenFor.has(norm)) return false;
      for (const branch of splitTopLevel(norm, ",")) {
        if (spokenFor.has(normalizeSelector(branch))) return false;
      }
      return true;
    };

    const wrapper = offered((s) => LOGO_SELECTOR.test(s) && /a:has\(/i.test(s));
    if (wrapper && untouched(wrapper.selector)) {
      rendered.push(
        `${normalizeSelector(wrapper.selector)} { display: inline-flex !important; align-items: center !important; `
        + "max-height: none !important; overflow: visible !important; }",
      );
      notes.push("logo_wrapper_allowed_to_grow_around_the_bigger_mark");
    }
    const header = offered((s) => s === "header");
    if (header && untouched("header")) {
      // Computed in JS, never emitted as calc(): the post-deploy check reads
      // the computed value back off the live page, and a resolved "120px" is
      // something it can compare. Padding of 24px keeps the mark off the edges.
      const min = Math.round(logoHeightPx + 24);
      rendered.push(`header { min-height: ${min}px !important; overflow: visible !important; }`);
      notes.push(`header_min_height_${min}px_so_the_whole_logo_is_visible`);
    }
  }

  return { css: rendered.join("\n"), notes };
}

/** The compact, client-scoped view the planner is allowed to see. */
function buildPlannerContext({ facts, rels, anchors, elements = [], assets = [], copy = [] }) {
  return [
    `BUSINESS FACTS (the only things this site may assert about itself):`,
    `- name: ${facts.businessName || "(unknown)"}`,
    `- trade: ${facts.trade || "(unknown)"}`,
    `- city/state: ${facts.city || "?"}, ${facts.state || "?"}`,
    `- phone: ${facts.phone || "(none published)"}`,
    facts.rating ? `- rating: ${facts.rating}` : null,
    `- services it lists: ${(facts.services || []).join(", ") || "(none)"}`,
    ``,
    `EDITABLE FILES: ${rels.join(", ")}`,
    ``,
    `ANCHORS you may insert next to (use the id, never the text):`,
    ...anchors.map((a) => `  ${a.id}  [${a.file} ${a.kind}] ${a.label}`),
    ``,
    `PAGE ELEMENTS (this is a compiled app — these exist at RUNTIME even though`,
    `index.html looks empty; target them with style_override). Your rule already`,
    `outranks the app's utility classes, so what decides whether a change is`,
    `visible is NOT !important — it is picking the element that actually holds the`,
    `thing you are changing. Use the id as "target":`,
    ...elements.map((e) => `  ${e.id}  ${e.selector}\n      ${e.note}`),
    ``,
    `IMAGES AND VIDEO THIS SITE ALREADY SERVES (the only media you may use —`,
    `you cannot fetch, generate or link anything else):`,
    ...(assets.length
      ? assets.map((a) => {
          const dims = a.width && a.height ? `${a.width}x${a.height} ${a.orientation}` : "size unknown";
          return `  ${a.id}  ${a.path}\n      ${a.kind}, "${a.label}", ${dims}${a.onPage ? ", already used on the page" : ""}`;
        })
      : ["  (this site ships no images of its own)"]),
    ``,
    `WORDS ON THE PAGE you may re-word with replace_copy (use the id). These are`,
    `the actual strings the visitor reads — the page is a compiled app, so they`,
    `are NOT in index.html and replace_text cannot reach them:`,
    ...(copy.length
      ? copy.map((c) => `  ${c.id}  "${c.text.length > 110 ? `${c.text.slice(0, 110)}…` : c.text}"`)
      : ["  (none could be read off this build)"]),
  ].filter((l) => l !== null).join("\n");
}

const PLAN_CONTRACT = `You convert one customer request into a PLAN for editing THEIR OWN website.

Return ONLY a JSON object, no prose, no markdown fence:
{"summary":"<one plain sentence a phone agent can read back>","ops":[ ... ]}
or, if it cannot be done truthfully or at all:
{"refusal":{"reason":"<short>","say":"<one sentence the agent says to the caller>"}}

Allowed ops (nothing else is executable):
1 {"op":"style_override","target":"<element id>","declarations":"<css declarations>","why":"<short>"}
    Visual changes: colour, size, spacing, position, hiding or showing.
    "target" is an id from PAGE ELEMENTS (e1, e2, …). "declarations" is ONLY
    the property list — "filter: saturate(1.4) !important;" — with NO selector
    and NO braces. The backend writes the selector for you.
    The site is a compiled page; this is appended as a commented <style> block
    at the end of <head> in index.html. Prefer this for anything visual.
2 {"op":"insert_html","anchor":"<catalog id>","position":"after"|"before","html":"<html>"}
    Adds a new visible element next to an existing heading.
3 {"op":"replace_text","file":"<file>","find":"<exact existing text>","replace":"<new text>"}
    Only for text you were shown. 'find' must appear EXACTLY ONCE in that file.
4 {"op":"seo_page","topic":"<one service the business already lists>"}
    A new SEO/service page. Only for a service in the facts above.
5 {"op":"undo"}
    Put the site back the way it was before the last change.
6 {"op":"replace_copy","target":"<copy id>","text":"<the new wording>"}
    RE-WORD SOMETHING ALREADY ON THE PAGE. "target" is an id from WORDS ON THE
    PAGE below (t1, t2, …). Use this for every "change the headline to…",
    "that should say…", "fix this wording" request. No quotes, angle brackets
    or line breaks in "text".
7 {"op":"copy_block","anchor":"<anchor id>","position":"after"|"before",
   "heading":"<short heading>","paragraphs":["…"],"bullets":["…"]}
    ADD a new block of words next to an existing heading. Give plain sentences,
    never HTML — the backend styles it to match the site.
8 {"op":"tracking_tag","vendor":"gtm|ga4|google_ads|meta_pixel|clarity","id":"<the ID>"}
    Install an analytics or advertising tag. The caller gives you an ID like
    GTM-NQV5LX64 or G-ABCD123456 — pass that ID through EXACTLY as spoken and
    nothing else. NEVER pass a code snippet, a <script> tag, or markup of any
    kind: this op takes an identifier, and the backend writes the vendor's own
    code itself. If the caller reads out a whole snippet, pull just the ID out
    of it. It goes on every page automatically, and installing one that is
    already there is refused rather than duplicated.
9 {"op":"swap_image","target":"<image id>","source_url":"https://…"}
    Replace one of the pictures under IMAGES AND VIDEO with a NEW one the
    caller has supplied a link to. The backend downloads it, checks it really
    is a picture, and hosts it on the customer's own site. Use this ONLY when
    there is a real https link to a specific image file. A link to a folder,
    or to a Drive "view" page, is not an image file — the backend will say so.
10 {"op":"legal_page","kind":"privacy"}
    Add a privacy page describing what the WEBSITE does with visitor
    information, linked from the bottom of the home page and listed in the
    sitemap. Only "privacy". A terms of service is a contract and is refused.
11 {"op":"restyle_site","color":"#16a34a","why":"<short>"}
    RECOLOUR THE WHOLE SITE in one go — every accent, button, link and
    highlight, everywhere. Use this when the caller asks to change the colour
    of the WHOLE site, its colour scheme or its theme branding. ONE element's
    colour is still a style_override — restyle_site is for "the whole site",
    "my colour scheme", "rebrand the colours". "color" is a single hex code, or
    a plain colour word like "green" (the backend turns it into the exact
    paint). You never name tokens, selectors or files here: the backend reads
    the site's own palette and repaints it, so a site whose colour is baked in
    gets refused honestly rather than half-painted.
12 {"op":"set_hero_video","why":"<short>"}
    SWAP THE HERO VIDEO for a new one WE GENERATE for this business (a
    Seedance clip from the caller's own approved video library). Takes NO
    url, NO file and NO id — the backend resolves the site's own approved
    clip, re-verifies it, and hosts it on the customer's site. Use it when the
    caller asks to change, swap or refresh the hero video, or wants a new
    video on the site. If they offer a video FILE or link of their own,
    refuse: customer-supplied video files are not supported yet.

RULES
- Change only what was asked. No redesigns, no "while we're here".
- NEVER assert anything about the business that is not in the FACTS above.
  No reviews, ratings, certifications, licences, guarantees, years in
  business, prices, availability or awards unless the FACTS carry them.
  If the request needs an unbacked claim, refuse with a say line like
  "I can't add that unless it's something you can back up."
- Keep it to at most ${PLAN_MAX_OPS} ops.
- Match the site's existing look; reuse its CSS custom properties.

WHAT YOU CAN DO WITHOUT ASKING FOR MATERIALS — the caller is a busy tradesperson
on the phone, not a designer. They say "make the logo bigger", "move it to the
right", "make the hero more colorful". Every one of those is a style_override
on a PAGE ELEMENT and you should just do it:
- Resize/reposition anything listed under PAGE ELEMENTS. RESIZE WITH width and
  height, never with transform:scale() — scale grows the picture but not the
  space it sits in, so a "bigger logo" ends up overhanging the header. "Make the
  logo twice as big" = height on the logo (plus max-width:100%), not scale(2).
  Move things across a flex row with margin-left:auto / margin-right:auto or
  flex-direction:row-reverse on the parent; order swaps. transform is still fine
  for translate/rotate.
- Restyle EXISTING imagery and video: filter (saturate/brightness/contrast/
  hue-rotate), a colour-wash overlay via a ::after with a gradient and
  pointer-events:none, object-position, opacity. "More colorful" on a hero =
  filter: saturate(1.NN) or a brand-colour gradient overlay — never a refusal.
- Interpret plain speech generously and pick the obvious reading. Do NOT refuse
  because the caller did not name a CSS selector — naming elements is YOUR job.

SELECTORS: every rule must be built on an id from PAGE ELEMENTS. Use "target"
and let the backend write the selector — that is the safe path. You have NOT
seen this site's markup (it is a compiled app; index.html is an empty shell), so
never invent an attribute value you were not shown, and never guess a link's
href: writing header a[href="/"] for the logo matched nothing on a real site and
silently did nothing. A selector that is not in PAGE ELEMENTS is REJECTED and the
whole edit fails, so guessing costs the customer their change.

NEVER emit a bare declaration. "filter: saturate(1.5) !important;" on its own is
not CSS — it styles nothing, and it is rejected. Either use "target" with
"declarations", or write a complete rule "<selector from PAGE ELEMENTS> { … }".

TEXT GOES ON THE TEXT, NOT ON THE BOX AROUND IT. This is the single most common
way an edit applies cleanly and changes nothing a customer can see. Colour, font,
font-size, weight, letter-spacing, line-height and alignment are INHERITED
properties: an element that has its own value ignores whatever its parent says.
Every headline, heading and paragraph on these sites carries its own utility
class, so a rule on the section around it reaches the section and stops there.
Measured on a live customer site: "make the main headline text bright orange" was
planned as a rule on section#top, the CSS applied perfectly, the section's colour
changed, the headline stayed white, and the customer was told it was live.
  - anything about WORDS  -> target the headline (h1), the headings (h2/h3), or
    the paragraphs (p). Never the hero, the header or a section.
  - background, filter, border, padding, margin, layout, hiding/showing -> the
    container is correct, target it.
After the change is deployed the page is RENDERED and every declaration is
checked against the computed style of the elements it matched. A rule that
matched nothing, or that lost to something on the element, is reported to the
customer as a failure and rolled back — so aiming at the wrong element no longer
looks like success, it costs them the change.

IMAGES: inside CSS you may only reference media listed under IMAGES AND VIDEO
THIS SITE ALREADY SERVES, by its exact /assets/... path — a style_override that
names an outside URL is rejected, and you cannot generate or find a picture.
There is exactly ONE way a new picture gets onto a site: swap_image, with an
https link the CALLER gave you to a specific image file. Re-dressing an image
the site already has (brighter, warmer, less grey) is still a style_override —
see below.

TRACKING CODE: when a caller says "add this tracking code", "put GTM on my
site", "here's my analytics ID", that is op tracking_tag and it is routine —
just do it. You pass the IDENTIFIER only. Never put a snippet, a tag or any
markup into a plan; there is no op that accepts code, and one that looks like
it does will be rejected. If they read out the whole block of code, find the
ID inside it (GTM-…, G-…, AW-…, a long number for Meta) and pass that.

"MORE COLORFUL" IS NOT A REQUEST FOR A NEW FILE. A caller saying the hero
should be "more colorful", "brighter", "warmer", "less washed out", "pop more",
or "not so grey" is describing how the EXISTING media looks. Restyle it —
filter: saturate()/brightness()/contrast(), or a brand-colour gradient overlay.
Do this even when the words "hero image" appear: "update the hero image to a
more colorful one" is a LOOK change. (These donors ship the hero in
grayscale(1), which is usually exactly what the caller is reacting to — so
setting a filter that drops the grayscale is the whole fix.)

REFUSE only when the caller wants a SPECIFIC piece of content we do not hold:
a particular photo, logo file or video ("put a photo of my new truck on there",
"use the picture I sent last week"), or an unbacked factual claim.

A REFUSAL FOR A MISSING IMAGE MUST OFFER WHAT WE HAVE. Never end the call on
"send me a file" alone, and never ask the caller to "identify the element" —
naming elements is your job, not theirs. Say what the site currently has, offer
the alternatives by their plain description from the catalog, and then invite the
file as the fallback. Describe those images only as pictures the site already
uses — you have not seen them, and you do not know whether they are the
customer's own photographs, so never call them "your photos".
Good: "Right now the hero runs the video. I've also got two upright shots and a
close-up of a fitting already on your site — want me to put one of those up
instead? Otherwise text me the photo you have in mind and I'll drop it in."`;

// Every COMPLETE, brace-balanced top-level {...} run in `text`, in order,
// string- and escape-aware so a "}" inside a JSON string never closes an
// object. Nested braces are consumed within their parent (the outer cursor
// jumps past a matched object), so only TOP-LEVEL objects are returned. A run
// that never closes (a truncated plan) contributes nothing.
function balancedObjects(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') {
        inStr = true;
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) { out.push(text.slice(i, j + 1)); i = j; break; }
      }
    }
  }
  return out;
}

function parsePlan(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  // Extract the FIRST complete, brace-balanced top-level object and ignore any
  // trailing content. The old slice ran from the first "{" to the LAST "}", so a
  // planner that emitted one valid object followed by ANY more content (a second
  // object, a prose note, a stray "}") produced a two-value slice that JSON.parse
  // rejected — "Unexpected non-whitespace character after JSON at position N".
  // Every model in the ladder does this occasionally and the 2-attempt retry
  // never helped because the model reproduces the same shape (2026-08-12: Family
  // Heating's "add more blue" edit failed exactly here). If the first balanced
  // object is itself unparseable, fall through to the next one.
  const candidates = balancedObjects(text);
  if (!candidates.length) throw new Error("planner returned no JSON object");
  let plan = null;
  let lastError = null;
  for (const candidate of candidates) {
    try { plan = JSON.parse(candidate); break; } catch (error) { lastError = error; }
  }
  if (!plan) {
    // A truncated plan dies HERE, before anything is touched. This is the
    // whole point of planning instead of regenerating files: the failure mode
    // of the old path was a half-file that parsed as "no changes" and reported
    // success.
    throw new Error(`planner returned unparseable JSON (${lastError && lastError.message})`);
  }
  if (plan.refusal) return { refusal: plan.refusal, ops: [], summary: "" };
  if (!Array.isArray(plan.ops) || !plan.ops.length) throw new Error("plan contains no ops");
  if (plan.ops.length > PLAN_MAX_OPS) throw new Error(`plan has ${plan.ops.length} ops (max ${PLAN_MAX_OPS})`);
  return { ops: plan.ops, summary: String(plan.summary || "").trim(), refusal: null };
}

// ---------------------------------------------------------------------------
// SCOPE — set membership against this client's real keys
// ---------------------------------------------------------------------------
function assertInScope(rel, allowedFiles) {
  const name = String(rel || "").trim();
  if (!name) throw new Error("op names no file");
  if (!allowedFiles.has(name)) {
    throw new Error(`out of scope: '${name}' is not a file in this client's site`);
  }
  if (!TEXT_EXT.test(name)) throw new Error(`out of scope: '${name}' is not an editable text file`);
  if (name.startsWith("assets/")) throw new Error(`out of scope: '${name}' is build output`);
  return name;
}

/**
 * An image op may only name a picture THIS SITE ALREADY SERVES — the same
 * membership test assertInScope() uses, run against the asset catalog, which
 * is itself derived from listAll(slug). So "swap that photo" can reach a
 * customer's own media and nothing else.
 */
function assertAssetInScope(path, assets) {
  const want = String(path || "").trim();
  const hit = (assets || []).find((a) => a.path === want);
  if (!hit) throw new Error(`out of scope: '${want.slice(0, 80)}' is not one of this site's own media files`);
  return hit.path.replace(/^\//, "");
}

/**
 * A refusal Riley can say, as opposed to a crash. Every gate in this module
 * that a CALLER can trip raises one of these, so a bad container ID or an
 * unreachable Drive link ends as a sentence rather than a failed job.
 */
function spokenRefusal(message, say) {
  const err = new Error(message);
  err.planRefusal = true;
  err.say = say;
  return err;
}

const isSpokenRefusal = (error) => Boolean(
  error && (error.truthRefusal || error.planRefusal || error.trackingRefusal || error.imageRefusal)
);

// ---------------------------------------------------------------------------
// THE EXECUTOR RETURNS ITS REFUSALS
// ---------------------------------------------------------------------------
// Half the owner's call complaints trace to one shape: the planner emitted an
// op the apply step could not execute — an unknown verb, an off-catalog anchor,
// a selector the catalog never offered — and the job died as status=failed
// carrying a developer string. A failed row with no `say` leaves Riley nothing
// to speak, so the caller heard silence about their own edit.
//
// The gates a CALLER can trip already throw spokenRefusal with a hand-written
// sentence. The gates the MODEL can trip threw plain Errors; those now come
// back as refusals whose sentence is derived from the error — every message in
// this module is written caller-readable precisely so this is possible. The
// conversion applies ONLY to errors raised before a byte is uploaded (the apply
// loop and the no-op invariants), where "nothing on your site changed" is a
// fact rather than a hope. Machinery that runs its own deploy inside the loop
// (seo_page, undo) marks its errors `machinery`, because those may have moved
// real bytes and must keep failing loudly instead of claiming nothing changed.
function plainApplySay(error) {
  const cleaned = String((error && error.message) || "could not apply the change")
    .replace(/^[a-z_ ]+:\s*/i, "") // "style_override: …" -> "…"
    .replace(/\s+/g, " ")
    .trim();
  const short = cleaned.length > 160 ? `${cleaned.slice(0, 157)}…` : cleaned;
  const lead = short ? `${short.charAt(0).toLowerCase()}${short.slice(1)}` : "the change I drafted was not one I can safely apply";
  return `I couldn't make that change — ${lead}. Nothing on your site changed, so tell me again in different words and I'll take another run at it.`;
}

// ---------------------------------------------------------------------------
// TRUTH LAW
// ---------------------------------------------------------------------------
// Each rule pairs a claim the page must not simply assert with the evidence
// that would make it sayable. Evidence is searched in the client's OWN
// published text — llms.txt plus the visible text of its own pages — never in
// the instruction. A caller asserting "we're licensed" on the phone is not a
// source; the business's own site is.
const CLAIM_RULES = Object.freeze([
  [/\blicen[sc]ed\b/i, "a licensing claim", /\blicen[sc]e/i],
  [/\binsured\b|\bbonded\b/i, "an insurance claim", /\binsured\b|\bbonded\b/i],
  [/\bcertified\b|\baccredited\b/i, "a credential claim", /\bcertified\b|\baccredited\b/i],
  [/\b24\s*\/\s*7\b|\b24 hours\b|\baround the clock\b/i, "a round-the-clock availability claim", /\b24\s*\/\s*7\b|\b24 hours\b|\baround the clock\b/i],
  [/\bsame[- ]day\b|\bemergency service\b/i, "a response-time claim", /\bsame[- ]day\b|\bemergency service\b/i],
  [/\bfree (estimate|quote|inspection)/i, "a free-offer claim", /\bfree (estimate|quote|inspection)/i],
  [/\bguarantee|\bwarrant(y|ied|ies)\b/i, "a guarantee", /\bguarantee|\bwarrant(y|ied|ies)\b/i],
  [/\baward|\btop[- ]rated\b|\bvoted\b|\bnumber one\b|\B#1\b/i, "a ranking claim", /\baward|\btop[- ]rated\b|\bvoted\b|\bnumber one\b/i],
  [/\byears? of experience\b|\byears? in business\b|\bsince (19|20)\d\d\b/i, "a tenure claim", /\byears? of experience\b|\byears? in business\b|\bsince (19|20)\d\d\b/i],
  [/\bfamily[- ]owned\b|\blocally owned\b|\bveteran[- ]owned\b/i, "an ownership claim", /\bfamily[- ]owned\b|\blocally owned\b|\bveteran[- ]owned\b/i],
  [/\bfinancing\b|\bdiscount\b|\bcoupon\b|\bspecial offer\b/i, "an offer claim", /\bfinancing\b|\bdiscount\b|\bcoupon\b|\bspecial offer\b/i],
  [/\$\s?\d/, "a price", /\$\s?\d/],
]);

function visibleText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Everything this business already says about itself, in one searchable blob. */
function buildArchiveEvidence(fileTexts) {
  const parts = [];
  for (const [rel, text] of Object.entries(fileTexts)) {
    if (/\.html?$/i.test(rel)) parts.push(visibleText(text));
    else if (/\.(txt|xml|json)$/i.test(rel)) parts.push(String(text));
  }
  return parts.join("\n");
}

const digits10 = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(-10);

/**
 * assertSubstantiated(newText, { evidence, facts })
 *
 * Throws a TruthRefusal when the text asserts something the client's own site
 * does not already publish. Returns the list of claims it cleared, so a job
 * record can show WHY a claim was allowed rather than only that it passed.
 */
function assertSubstantiated(newText, { evidence, facts }) {
  const text = visibleText(newText);
  if (!text) return { claims: [] };
  const cleared = [];

  for (const [claimRe, label, evidenceRe] of CLAIM_RULES) {
    const hit = text.match(claimRe);
    if (!hit) continue;
    if (evidenceRe.test(evidence)) { cleared.push({ label, quoted: hit[0].trim() }); continue; }
    const err = new Error(`unsourced: the site does not publish ${label} ("${hit[0].trim()}")`);
    err.truthRefusal = true;
    err.say = "I can't add that unless it's something you can back up — it isn't anywhere on your site right now, so I'd be putting a claim on there neither of us can stand behind.";
    throw err;
  }

  // Any phone-shaped run must be the business's own line.
  const want = digits10(facts.phone);
  for (const m of text.matchAll(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g)) {
    if (want && digits10(m[0]) === want) continue;
    const err = new Error(`unsourced: phone number ${m[0]} is not this business's number`);
    err.truthRefusal = true;
    err.say = "That's not the number on your account, so I'm not going to put it on the site. If the number changed, tell me the new one and I'll get it verified first.";
    throw err;
  }

  // A figure the site has never published is a fabricated figure. This is the
  // rule that stops "4.9 from 320 reviews" on a business with 106 of them.
  //
  // Two passes, because they answer different questions:
  //   REPUTATION figures (a rating, a star count, a review count) are gated at
  //   ANY size — "3 reviews" is as much a claim as "3,000".
  //   Every OTHER figure is gated from two digits up. A bare single digit is
  //   almost always structure ("out of 5", "step 2"), not an assertion, and
  //   refusing those would refuse the honest rendering of a sourced rating.
  const evidenceDigits = evidence.replace(/[^\d.]+/g, " ");
  const published = (num) => new RegExp(`(^|\\D)${String(num).replace(".", "\\.")}(\\D|$)`).test(evidenceDigits);
  const refuse = (num, what) => {
    const err = new Error(`unsourced: ${what} "${num}" does not appear anywhere on this site`);
    err.truthRefusal = true;
    err.say = `I can't put the number ${num} on there — it isn't published anywhere on your site, so there's nothing backing it up. If it's right, send it over and we'll get it sourced first.`;
    throw err;
  };
  const REPUTATION = [
    /(\d+(?:\.\d+)?)\s*(?:out of|\/)\s*5\b/gi,
    /(\d[\d,]*)\s*(?:google\s+|yelp\s+)?(?:reviews?|ratings?)\b/gi,
    /(\d+(?:\.\d+)?)\s*stars?\b/gi,
  ];
  for (const re of REPUTATION) {
    for (const m of text.matchAll(re)) {
      const num = m[1].replace(/,/g, "");
      if (!published(num)) refuse(num, "the reputation figure");
    }
  }
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const num = m[0].replace(/,/g, "");
    if (num.length < 2) continue;
    if (published(num)) continue;
    if (want && digits10(text).includes(num)) continue;
    refuse(num, "the figure");
  }
  return { claims: cleared };
}

/**
 * CSS can speak. `content: "Licensed & insured"` puts words on the page
 * without a single HTML tag, so generated CSS is gated on the strings it can
 * render, not waved through because it is "just styling".
 */
function cssSpokenText(css) {
  const out = [];
  for (const m of String(css || "").matchAll(/content\s*:\s*(['"])([\s\S]*?)\1/gi)) out.push(m[2]);
  return out.join(" ");
}

// ---------------------------------------------------------------------------
// Deterministic apply
// ---------------------------------------------------------------------------
const MARK_OPEN = (jobId) => `<!-- wss-edit ${jobId} -->`;

/**
 * One sentence Riley can say out loud, past tense.
 *
 * The planner writes its summary as an intention ("I will add your Google
 * rating…") because that is what a plan is. Read back verbatim after the fact
 * it lands as "Done — We will add…", which is both ungrammatical and, worse,
 * ambiguous about whether anything actually happened. So the modal is stripped
 * here rather than left to the model to get right on every call.
 */
function spokenResult(summary) {
  const tail = "It's live on your site now, and I can put it straight back if it isn't right.";
  const cleaned = String(summary || "")
    .trim()
    .replace(/^(?:i|we|this|that|it)\s*(?:'ll|’ll| will| am going to| going to)\s+/i, "")
    .replace(/^(?:i|we)\s*(?:'ve|’ve| have)\s+/i, "")
    .replace(/\s*[.!]+$/, "");
  if (!cleaned) return `That's done. ${tail}`;
  return `Done — ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}. ${tail}`;
}

function applyStyleOverride(html, { css, why, jobId }) {
  const block = `\n${MARK_OPEN(jobId)}\n<style data-wss-edit="${jobId}">\n/* ${String(why || "customer request").replace(/[<>]/g, "")} */\n${css}\n</style>\n`;
  const at = html.lastIndexOf("</head>");
  if (at < 0) throw new Error("style_override: index.html has no </head>");
  return html.slice(0, at) + block + html.slice(at);
}

function applyInsertHtml(html, { exact, position, fragment, jobId }) {
  const count = html.split(exact).length - 1;
  if (count !== 1) throw new Error(`insert_html: anchor occurs ${count} times, refusing`);
  const payload = `\n${MARK_OPEN(jobId)}\n${fragment}\n`;
  return position === "before" ? html.replace(exact, payload + exact) : html.replace(exact, exact + payload);
}

function applyReplaceText(text, { find, replace }) {
  const count = text.split(find).length - 1;
  if (count === 0) throw new Error(`replace_text: "${String(find).slice(0, 60)}" is not on that page`);
  if (count > 1) throw new Error(`replace_text: "${String(find).slice(0, 60)}" appears ${count} times, refusing to guess which`);
  return text.replace(find, replace);
}

// ===========================================================================
// TRACKING TAGS — the narrow, audited exception to "no script injection"
// ===========================================================================
// insert_html refuses <script>, <iframe> and on*= handlers, and that rail is
// not negotiable: it is the only thing standing between a compromised or
// confused planner and arbitrary JavaScript running on a paying customer's
// live site, in front of their customers, with their domain in the address
// bar. A planner that can be talked into emitting markup can be talked into
// emitting <script>fetch('https://…?c='+document.cookie)</script>.
//
// And yet the single most common real support ticket in the owner's queue is
// "paste this code as high in the <head> as possible" with a Google Tag
// Manager container attached. Refusing it outright means the product cannot do
// the thing customers ask for most. So the resolution is not to relax the
// rail — it is to route around the thing the rail is actually protecting
// against.
//
// WHAT MAKES THIS SAFE IS THAT THE CUSTOMER NEVER SUPPLIES MARKUP.
//
//   1. The customer supplies an IDENTIFIER, not code. "GTM-NQV5LX64" is 12
//      characters drawn from [A-Z0-9-] and matched against ^GTM-[A-Z0-9]{6,10}$.
//      There is no string matching that pattern that is also executable: it
//      cannot contain <, >, ", ', /, ;, (, ) or whitespace, so it cannot close
//      our string, close our tag, open another tag, or start a new statement.
//      Injection through this parameter is not "unlikely", it is unexpressible.
//   2. The SNIPPET IS OURS. It is a frozen template in this file, byte for
//      byte the vendor's own published loader, with exactly one substitution
//      point. The planner does not write it, cannot see it, and cannot vary
//      it — the plan carries {vendor, id} and nothing else.
//   3. The ORIGIN IS FIXED. Each vendor entry names the host its loader may
//      fetch from, that host is a literal inside our template, and
//      assertTemplateOriginsAllowed() re-derives every absolute URL out of the
//      RENDERED snippet and checks it against that list before the bytes are
//      accepted. So a future edit to a template that quietly points somewhere
//      else fails the gate instead of shipping.
//   4. IT IS LABELLED AND COUNTABLE. Every installed tag is wrapped in
//      <!-- wss-tag:<vendor> <id> --> … <!-- /wss-tag:<vendor> -->, so the
//      inventory is readable straight off the deployed bytes rather than out
//      of a database we would have to trust. readInstalledTags() is what the
//      generated privacy page enumerates, what makes a repeat install
//      idempotent, and what an auditor greps for.
//
// GENERAL SCRIPT INJECTION STAYS REFUSED. insert_html is untouched. There is
// no op that takes markup and puts it on a page. If a vendor is not in the
// registry below, the answer is "a person will do that one", not "paste this".
// Adding a vendor is a code change with a test, which is the correct amount of
// friction for a decision to let a third party run code on customer sites.
//
// THE <noscript><iframe> HALF, ARGUED RATHER THAN ASSUMED. GTM's canonical
// snippet has two parts, and the second is an iframe. Shipping only the head
// half would be quietly non-canonical — the tag would work, and the owner
// would have a support burden nobody could see. It is included because the
// iframe's src is built by US from a validated id against a literal host, so
// it carries exactly the same proof as the script half: the only variable is
// 12 characters that cannot express markup. The blanket iframe ban exists
// because the PLANNER supplies the markup there; here it does not.
const TRACKING_VENDORS = Object.freeze({
  gtm: {
    label: "Google Tag Manager",
    // Containers are GTM- plus 6-10 upper-case alphanumerics. Ricardo's real
    // ticket carried GTM-NQV5LX64 (8), older containers are 6.
    idPattern: /^GTM-[A-Z0-9]{6,10}$/,
    normalize: (v) => v.toUpperCase(),
    hint: "GTM-XXXXXXX",
    origins: ["https://www.googletagmanager.com"],
    // What the privacy page is allowed to say this does. Descriptive, and
    // deliberately hedged: what a container actually sends is configured in
    // the customer's own GTM account, which this system cannot see.
    describes: "loads whichever tags the container is configured to load, which may include analytics and advertising tags",
    privacyUrl: "https://policies.google.com/privacy",
    head: (id) => `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`,
    body: (id) => `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
  },
  ga4: {
    label: "Google Analytics 4",
    idPattern: /^G-[A-Z0-9]{8,12}$/,
    normalize: (v) => v.toUpperCase(),
    hint: "G-XXXXXXXXXX",
    origins: ["https://www.googletagmanager.com"],
    describes: "records page views and basic visit information for Google Analytics",
    privacyUrl: "https://policies.google.com/privacy",
    head: (id) => `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`,
    body: null,
  },
  google_ads: {
    label: "Google Ads conversion tag",
    idPattern: /^AW-\d{9,12}$/,
    normalize: (v) => v.toUpperCase(),
    hint: "AW-123456789",
    origins: ["https://www.googletagmanager.com"],
    describes: "records visits and conversions for Google Ads",
    privacyUrl: "https://policies.google.com/privacy",
    head: (id) => `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`,
    body: null,
  },
  meta_pixel: {
    label: "Meta pixel",
    idPattern: /^\d{15,16}$/,
    normalize: (v) => v.replace(/\D/g, ""),
    hint: "a 15 or 16 digit pixel ID",
    origins: ["https://connect.facebook.net", "https://www.facebook.com"],
    describes: "records visits for Meta (Facebook and Instagram) advertising",
    privacyUrl: "https://www.facebook.com/privacy/policy",
    head: (id) => `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');</script>`,
    body: (id) => `<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/></noscript>`,
  },
  clarity: {
    label: "Microsoft Clarity",
    idPattern: /^[a-z0-9]{8,12}$/,
    normalize: (v) => v.toLowerCase(),
    hint: "a 10-character project ID",
    origins: ["https://www.clarity.ms"],
    describes: "records how visitors move through the pages for Microsoft Clarity",
    privacyUrl: "https://privacy.microsoft.com/privacystatement",
    head: (id) => `<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${id}");</script>`,
    body: null,
  },
});

// A caller says "Google Tag Manager", "GTM", "tag manager", "analytics". The
// planner should not have to guess our internal key, and a near-miss must not
// become a refusal the customer hears.
const VENDOR_ALIASES = Object.freeze({
  gtm: "gtm", googletagmanager: "gtm", tagmanager: "gtm", googletagmanager2: "gtm",
  ga: "ga4", ga4: "ga4", googleanalytics: "ga4", analytics: "ga4", gtag: "ga4",
  googleads: "google_ads", adwords: "google_ads", aw: "google_ads", googleadwords: "google_ads",
  meta: "meta_pixel", metapixel: "meta_pixel", facebook: "meta_pixel",
  facebookpixel: "meta_pixel", fb: "meta_pixel", fbpixel: "meta_pixel", pixel: "meta_pixel",
  clarity: "clarity", microsoftclarity: "clarity",
});

function vendorKey(vendor, id = "") {
  const flat = String(vendor || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (TRACKING_VENDORS[flat]) return flat;
  if (VENDOR_ALIASES[flat]) return VENDOR_ALIASES[flat];
  // A vendor we could not name is still recoverable when the ID itself is
  // unambiguous — every registry prefix is distinct — so "add this code,
  // GTM-NQV5LX64" resolves rather than being bounced back to the caller.
  const raw = String(id || "").trim().toUpperCase();
  for (const [key, spec] of Object.entries(TRACKING_VENDORS)) {
    if (spec.idPattern.test(spec.normalize(raw))) return key;
  }
  return "";
}

/**
 * validateTrackingTag({ vendor, id })
 * -> { key, spec, id }   throws a caller-readable refusal otherwise.
 *
 * This is the whole security boundary of the tracking op, so it is a pure
 * function with no I/O and it is tested directly.
 */
function validateTrackingTag({ vendor, id }) {
  const raw = String(id || "").trim();
  const key = vendorKey(vendor, raw);
  if (!key) {
    const known = Object.values(TRACKING_VENDORS).map((v) => v.label).join(", ");
    const err = new Error(`tracking_tag: '${String(vendor || "").slice(0, 40)}' is not a tracking vendor this system installs (${known})`);
    err.trackingRefusal = true;
    err.say = "That one isn't a tag I can install from here — I'm putting it in front of a person on our team today and we'll come back to you. Nothing on your site has changed.";
    throw err;
  }
  const spec = TRACKING_VENDORS[key];
  const normalized = spec.normalize(raw);
  if (!spec.idPattern.test(normalized)) {
    const err = new Error(`tracking_tag: '${raw.slice(0, 40)}' is not a valid ${spec.label} ID (expected ${spec.hint})`);
    err.trackingRefusal = true;
    err.say = `That doesn't look like a complete ${spec.label} ID — it should look like ${spec.hint}. Read it to me once more and I'll get it on there.`;
    throw err;
  }
  return { key, spec, id: normalized };
}

/**
 * Re-derive every absolute URL out of the RENDERED snippet and check it
 * against the vendor's declared origins.
 *
 * The registry above is data, and data drifts. This turns "our template is
 * safe because we wrote it" into a property that is re-proved on every single
 * install, against the exact bytes about to be uploaded. A template edited to
 * point at a different host fails here instead of shipping to customers.
 */
function assertTemplateOriginsAllowed(snippet, spec) {
  for (const m of String(snippet).matchAll(/https?:\/\/[^'"\s)\\]+/gi)) {
    let origin;
    try { origin = new URL(m[0]).origin; } catch { origin = ""; }
    if (!spec.origins.includes(origin)) {
      throw new Error(`tracking_tag: snippet template points at '${origin || m[0].slice(0, 40)}', which is not one of ${spec.label}'s declared origins`);
    }
  }
  return true;
}

const TAG_OPEN = (key, id) => `<!-- wss-tag:${key} ${id} -->`;
const TAG_CLOSE = (key) => `<!-- /wss-tag:${key} -->`;
const tagRegionRe = (key) => new RegExp(`\\n?<!-- wss-tag:${key} [^>]*-->[\\s\\S]*?<!-- /wss-tag:${key} -->\\n?`, "g");

/** The inventory, read off the shipped bytes rather than out of a database. */
function readInstalledTags(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<!-- wss-tag:([a-z0-9_]+) ([^\s>]+) -->/g)) {
    if (!out.some((t) => t.key === m[1] && t.id === m[2])) out.push({ key: m[1], id: m[2] });
  }
  return out;
}

function stripTagRegions(html, key) {
  return String(html).replace(tagRegionRe(key), "\n");
}

/**
 * "As high in the <head> as possible" — the customer's own words, and the
 * vendor's instruction, because a tag placed below a slow stylesheet measures
 * fewer visits than actually arrived.
 *
 * The one thing that must come first is <meta charset>: a parser that meets
 * script bytes before it knows the encoding can mis-decode the document. So
 * "as high as possible" resolves to "immediately after the charset
 * declaration", which is as high as it is correct to go.
 */
function insertTagInHead(html, snippet) {
  const charset = String(html).match(/<meta[^>]+charset[^>]*>/i);
    if (charset) {
    const at = html.indexOf(charset[0]) + charset[0].length;
    return html.slice(0, at) + `\n${snippet}` + html.slice(at);
  }
  const head = String(html).match(/<head[^>]*>/i);
  if (!head) throw new Error("tracking_tag: page has no <head> to install into");
  const at = html.indexOf(head[0]) + head[0].length;
  return html.slice(0, at) + `\n${snippet}` + html.slice(at);
}

/** The noscript half goes immediately after <body>, as the vendor specifies. */
function insertTagInBody(html, snippet) {
  const body = String(html).match(/<body[^>]*>/i);
  if (!body) throw new Error("tracking_tag: page has no <body> to install into");
  const at = html.indexOf(body[0]) + body[0].length;
  return html.slice(0, at) + `\n${snippet}` + html.slice(at);
}

/**
 * installTrackingTag(html, { key, spec, id })  -> { html, changed, replacedId }
 *
 * Idempotent by construction. Installing the SAME id twice is a no-op, because
 * two copies of a GTM loader mean every visit is counted twice and the
 * customer's numbers silently double. Installing a DIFFERENT id for the same
 * vendor replaces the old one rather than stacking, for the same reason.
 */
function installTrackingTag(html, { key, spec, id }) {
  const existing = readInstalledTags(html).filter((t) => t.key === key);
  if (existing.some((t) => t.id === id)) return { html, changed: false, replacedId: null };
  const replacedId = existing.length ? existing[0].id : null;

  const headSnippet = spec.head(id);
  assertTemplateOriginsAllowed(headSnippet, spec);
  const bodySnippet = spec.body ? spec.body(id) : "";
  if (bodySnippet) assertTemplateOriginsAllowed(bodySnippet, spec);

  let next = stripTagRegions(html, key);
  next = insertTagInHead(next, `${TAG_OPEN(key, id)}\n${headSnippet}\n${TAG_CLOSE(key)}`);
  if (bodySnippet) next = insertTagInBody(next, `${TAG_OPEN(key, id)}\n${bodySnippet}\n${TAG_CLOSE(key)}`);
  return { html: next, changed: true, replacedId };
}

// ===========================================================================
// IMAGE INTAKE — fetched, sniffed, and hosted on the client's own mirror
// ===========================================================================
// The real ticket is "replace this photo with the one in this Drive folder".
// The tempting implementation — point the <img> at the Drive URL — is wrong in
// a way that only shows up weeks later: a share link is a permission, and the
// day that permission changes the customer's website has a hole in it. The
// same is true of every third-party URL a customer will ever send. So a
// supplied image is treated as an INTAKE, not a reference: fetch it once,
// prove it is really an image, and serve it from the customer's own domain
// forever after.
//
// The sniff is not politeness. A Google Drive "share" URL returns an HTML
// interstitial, not the file — so the naive version of this feature ships a
// text/html document to an <img> tag and the customer's site quietly loses a
// photo. Reading the magic bytes is what turns that into a sentence Riley can
// say. SVG is refused on purpose: it is a document format that can carry
// script, and "it is an image" is not true of it in the sense that matters
// here.
const IMAGE_MAGIC = Object.freeze([
  { ext: "png", type: "image/png", test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a },
  { ext: "jpg", type: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", type: "image/gif", test: (b) => b.length > 6 && ["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6)) },
  { ext: "webp", type: "image/webp", test: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
]);

/** -> { ext, type } for a real raster image, null for anything else. */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  return IMAGE_MAGIC.find((m) => m.test(buf)) || null;
}

// Hostnames that must never be fetched on a customer's behalf. A URL is
// attacker-supplied input even when the attacker is only a confused caller,
// and this backend runs where it can see things a browser cannot.
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
const IP_LITERAL = /^\[?[0-9a-f:.]+\]?$/i;

function assertFetchableImageUrl(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); } catch {
    const err = new Error(`swap_image: '${String(raw || "").slice(0, 60)}' is not a URL`);
    err.imageRefusal = true;
    err.say = "That link didn't come through as a web address I can open. Send it over again and I'll pick it up.";
    throw err;
  }
  const fail = (message, say) => {
    const err = new Error(message);
    err.imageRefusal = true;
    err.say = say;
    throw err;
  };
  // http:// has already cost this system a whole build (a single http image URL
  // failed a schema validation and was reported as an unrelated error), and a
  // plaintext fetch is a downgrade we would be choosing on a customer's behalf.
  if (url.protocol !== "https:") {
    fail(`swap_image: refuses ${url.protocol} — only https URLs are fetched`, "That link isn't a secure address, so I'm not going to pull a file off it. If there's an https version I'll take that.");
  }
  if (url.username || url.password) fail("swap_image: refuses a URL carrying credentials", "That link has a sign-in built into it, so I'm not going to use it. A plain shareable link works better.");
  if (PRIVATE_HOST.test(url.hostname) || IP_LITERAL.test(url.hostname)) {
    fail(`swap_image: refuses to fetch from '${url.hostname}'`, "That address points somewhere I'm not allowed to reach. Send me a normal public link to the picture and I'll grab it.");
  }
  return url;
}

/**
 * fetchImageBytes(url, { fetchImpl, maxBytes })
 * -> { buf, sniff, sourceUrl, finalUrl, bytes, sha256 }
 *
 * Throws with `.imageRefusal` and a spoken sentence for every rejection a
 * caller could plausibly cause, so a bad link is a conversation rather than a
 * failed job.
 */
async function fetchImageBytes(rawUrl, { fetchImpl = fetch, maxBytes = 8_000_000 } = {}) {
  const url = assertFetchableImageUrl(rawUrl);
  const fail = (message, say) => {
    const err = new Error(message);
    err.imageRefusal = true;
    err.say = say;
    throw err;
  };
  let res;
  try {
    // IDENTIFY OURSELVES. Measured: a bare fetch of a Wikimedia Commons image
    // — the kind of link a customer sends every day — comes back 400 with an
    // HTML error body, because a request with no User-Agent is refused by a
    // lot of the web. Without this the sniff would then report "that link gave
    // me a web page rather than a picture", which is true of the bytes and
    // completely misleading about the cause. A named agent is also the honest
    // thing to put in someone else's access log.
    res = await fetchImpl(url.toString(), {
      redirect: "follow",
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
        "user-agent": "WSS-Labs-SiteEditor/1.0 (+https://wss-ai.com; fetches images a customer asked us to put on their own site)",
      },
    });
  } catch (error) {
    fail(`swap_image: could not fetch ${url.hostname} (${String(error.message || error).slice(0, 80)})`,
      "I couldn't get that picture to download just now. Let me have someone on our team pick it up so it doesn't get lost.");
  }
  // A redirect can land somewhere the first check would have refused, so the
  // final hop is re-checked rather than trusted.
  if (res.url) assertFetchableImageUrl(res.url);
  if (!res.ok) {
    fail(`swap_image: ${url.hostname} answered ${res.status}`,
      res.status === 403 || res.status === 401
        ? "That link is asking for permission before it'll hand the picture over, so I can't reach it. If it can be set so anyone with the link can view it, I'll grab it straight away."
        : "That link didn't give me the picture back. I'll get a person on our team to chase it rather than guess.");
  }
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    fail(`swap_image: ${declared} bytes exceeds the ${maxBytes} cap`,
      "That picture is much bigger than a web page should carry. A smaller version of the same photo would work — I'll have someone size it for you.");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    fail(`swap_image: ${buf.length} bytes exceeds the ${maxBytes} cap`,
      "That picture is much bigger than a web page should carry. A smaller version of the same photo would work — I'll have someone size it for you.");
  }
  const sniff = sniffImage(buf);
  if (!sniff) {
    // THE DRIVE CASE, NAMED. A /file/d/…/view link returns the viewer page.
    const looksLikeHtml = buf.slice(0, 512).toString("utf8").trim().toLowerCase().startsWith("<");
    const isSvg = /<svg[\s>]/i.test(buf.slice(0, 1024).toString("utf8"));
    fail(
      `swap_image: ${url.hostname} returned ${looksLikeHtml ? "an HTML document" : "bytes that are not a PNG, JPEG, GIF or WebP"}`,
      isSvg
        ? "That file is a vector graphic rather than a photo, and I don't put those straight onto a live site. A PNG or a JPEG of the same artwork and I'll have it up in a minute."
        : looksLikeHtml
          ? "That link opened a web page rather than handing me the picture itself — it's the folder view rather than the file. If you open the photo and copy the direct image link, I'll drop it in."
          : "That file didn't come through as a picture I can read. A PNG or a JPEG will go straight on.",
    );
  }
  return {
    buf,
    sniff,
    sourceUrl: url.toString(),
    finalUrl: String(res.url || url.toString()),
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

/** "hero-detail-fitting-CjWkqcPK.jpg" -> "hero-detail-fitting" */
function assetStem(rel) {
  const base = String(rel).split("/").pop().replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/-([A-Za-z0-9_-]{8})$/, (m, seg) =>
    (/[A-Z]/.test(seg) && /[a-z0-9_]/.test(seg) ? "" : m));
  return ((cleaned || base).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "image";
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Repoint every reference to `oldPath` at `newPath`, across the shell files
 * AND the compiled bundle.
 *
 * WHY A NEW PATH RATHER THAN OVERWRITING THE OLD FILE. Overwriting the bytes
 * at /assets/photo.jpg is a one-liner and every reference follows for free —
 * but it forces the incoming picture to be the same FORMAT as the one it
 * replaces, because Vercel derives Content-Type from the extension. A customer
 * who sends a PNG for a JPEG slot would then be told to go and convert it,
 * which is precisely the "make the caller do the engineering" failure the
 * persona rules ban. Re-pathing accepts whatever real image arrives, serves it
 * under an honest content type, leaves the original file untouched (so undo is
 * a text restore rather than a byte restore), and busts any cache on the way
 * past.
 *
 * The boundary assertion matters: /assets/hero.mp4 must not match inside
 * /assets/hero.mp4.map. The lookahead requires the next character to be a
 * quote, a backslash (the bundle stores paths inside escaped strings), a
 * query, a paren, whitespace, or end of file.
 */
function rewriteAssetReferences(texts, oldPath, newPath) {
  const re = new RegExp(`${escapeRe(oldPath)}(?=["'?)\\s\\\\]|$)`, "g");
  const changed = [];
  for (const rel of Object.keys(texts)) {
    const before = String(texts[rel]);
    const matches = before.match(re);
    if (!matches) continue;
    texts[rel] = before.replace(re, newPath);
    changed.push({ file: rel, count: matches.length });
  }
  return changed;
}

// ===========================================================================
// SET_HERO_VIDEO — a generated hero clip, attached at edit time
// ===========================================================================
// The owner's ask, verbatim in intent: "Riley should be able to generate a new
// Seedance video and port that into their site." The generation half already
// exists — the Seedance worker lands owner-approved clips, with provenance, in
// the client's own media bank (record.media_bank.hero_reel, written ONLY by
// the upload boundary api/admin/hero-clip-upload.js after an approval). What
// was missing was the port: nothing could attach that clip to a LIVE site
// after build time.
//
// WHAT THIS VERB IS, AND IS NOT.
//   · THE CLIP COMES FROM THE PROVENANCE STORE, resolved by the backend —
//     never a URL the model or the caller typed. The op carries no url field
//     and none is read: an address is not a proof, and a hotlink was never an
//     option for these mirrors anyway.
//   · SEEDANCE ONLY. The same gates the build lane applies before a generated
//     clip may ride the ladder are re-applied here: the generator must be the
//     durable Seedance producer and the provenance must carry the accepted
//     checkpoint chain, the generation receipt digest, and the clip's own
//     sha256. Customer-supplied video FILES remain a dashboard-upload future
//     item — this verb cannot be talked into hosting one.
//   · THE BYTES ARE RE-VERIFIED. The clip is downloaded fresh and its sha256
//     compared with the provenance's recorded output_sha256 before a byte is
//     uploaded; a store entry that no longer matches its own receipt is a
//     refusal, not a swap.
//   · THE PAGE DECIDES WHERE IT PLAYS. Donors ship a hero-video LADDER —
//     <script id="hero-video-ladder">{"sources":[…]}</script> — and each
//     donor's walker arms sources[0] onto the marked video[data-hero-video].
//     The swap replaces the top rung in that JSON and BUMPS the ladder's
//     `version`, so the deployed bytes themselves show the ladder changed
//     hands. Any OTHER reference to the retired rung follows the same
//     boundary-tested rewrite swap_image uses (rewriteAssetReferences above).
//     At the next rebuild the engine recomputes the ladder and
//     lib/site-edit-replay.js re-applies the swap through THIS SAME apply
//     function — the recorded op is the identity, never a guess.
const heroLadderRe = () => /(<script\b[^>]*\bid\s*=\s*(["'])hero-video-ladder\2[^>]*>)([\s\S]*?)(<\/script>)/gi;

/** Every parseable ladder island on one page, in document order. */
function parseHeroLadders(html) {
  const out = [];
  for (const m of String(html || "").matchAll(heroLadderRe())) {
    try {
      const parsed = JSON.parse(m[3]);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.sources)) {
        out.push({ whole: m[0], open: m[1], close: m[4], parsed });
      }
    } catch { /* a ladder that cannot be parsed is a ladder this verb does not touch */ }
  }
  return out;
}

/** The page's declared rung order, or null when no readable ladder is there. */
function heroLadderSources(html) {
  for (const ladder of parseHeroLadders(html)) {
    return ladder.parsed.sources.map((s) => String(s || "").trim()).filter(Boolean);
  }
  return null;
}

/**
 * applyHeroLadderSwap(html, { from, to }) -> { html, changed, version }
 *
 * The ONE apply function for a ladder swap — the edit-time loop and
 * lib/site-edit-replay.js both call it, so a rebuild replays the exact bytes
 * this wrote. `from` is the rung being retired (replaced in place — the new
 * clip takes the position the old one held, and every later rung keeps its
 * place); `from` empty means the ladder declared no playable rung and the new
 * clip is PREPENDED. `version` is bumped on every ladder actually touched, so
 * an operator can read the change of hands out of the deployed JSON.
 */
function applyHeroLadderSwap(html, { from, to }) {
  const target = String(to || "").trim();
  if (!target) throw new Error("set_hero_video: no destination path for the ladder");
  let changed = 0;
  let version = null;
  const next = String(html || "").replace(heroLadderRe(), (whole, open, quote, json, close) => {
    let parsed;
    try { parsed = JSON.parse(json); } catch { return whole; }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sources)) return whole;
    const sources = parsed.sources.map((s) => String(s || "").trim()).filter(Boolean);
    const retire = String(from || "").trim();
    if (retire) {
      const at = sources.indexOf(retire);
      if (at === -1) return whole;
      sources[at] = target;
    } else {
      sources.unshift(target);
    }
    changed += 1;
    version = (Number(parsed.version) || 0) + 1;
    return `${open}${JSON.stringify({ ...parsed, sources, version })}${close}`;
  });
  return { html: changed ? next : String(html || ""), changed, version };
}

// The store-side download cap. Mirrors the clip ceiling the Seedance lane
// itself enforces (lib/hero-reel-runner.js downloadTo).
const MAX_HERO_CLIP_BYTES = 20 * 1024 * 1024;
const SEEDANCE_CHECKPOINT_SCHEMA = "wss.hero.seedance_provider_checkpoint.v1";
const SEEDANCE_RECEIPT_SCHEMA = "wss.hero.seedance_generation_receipt.v1";
const SHA256_RE = /^[a-f0-9]{64}$/i;

/**
 * Why a stored reel may NOT ride the hero — every gate heroReelBlock applies
 * at build time, as a readable fault string. Empty means it passed.
 */
function seedanceProvenanceFault(reel) {
  if (!reel || typeof reel !== "object") return "reel_missing";
  const generator = String(reel.generator || "");
  if (generator !== OPENROUTER_SEEDANCE_PRODUCER) return `generator_is_not_seedance:${generator || "none"}`;
  if (!isDurableHeroProducer(generator)) return "generator_not_durable";
  const p = reel.provenance && typeof reel.provenance === "object" ? reel.provenance : null;
  if (!p) return "provenance_missing";
  if (String(p.generator || "") !== generator) return "provenance_generator_mismatch";
  if (p.kind !== "seedance_generated") return "provenance_not_seedance_generated";
  if (p.checkpoint_schema !== SEEDANCE_CHECKPOINT_SCHEMA) return "provenance_checkpoint_schema_unknown";
  if (!String(p.provider_job_id || "") || !String(p.hero_job_id || "") || !String(p.attempt_id || "")) {
    return "provenance_chain_incomplete";
  }
  if (p.generation_receipt_schema !== SEEDANCE_RECEIPT_SCHEMA) return "generation_receipt_schema_unknown";
  if (!SHA256_RE.test(String(p.generation_receipt_sha256 || ""))) return "generation_receipt_sha256_missing";
  if (!SHA256_RE.test(String(p.output_sha256 || ""))) return "output_sha256_missing";
  return "";
}

/**
 * defaultResolveHeroVideoClip({ siteSlug, requested, select, fetchImpl })
 *   -> { bytes, sha256, generator, provenance, clipRef, sourceUrl }
 *
 * The ONLY door between a plan and a hero clip. The store is the client's own
 * media bank; the join to THIS site is the same one riley-context and
 * site-edit-targets use (loose LIKE on preview_url, then the row must
 * re-derive to EXACTLY this slug — a substring match is how one business's
 * media gets attributed to another whose slug contains it). Every gate a
 * caller can trip raises a spoken refusal; every gate that is OUR machinery
 * failing raises a plain error, because "nothing on your site changed" must
 * stay a fact.
 */
async function defaultResolveHeroVideoClip({
  siteSlug,
  requested = "",
  select: injectedSelect = null,
  fetchImpl = fetch,
  maxBytes = MAX_HERO_CLIP_BYTES,
} = {}) {
  let selectImpl = injectedSelect;
  if (typeof selectImpl !== "function") {
    try { ({ select: selectImpl } = require("./store")); } catch { selectImpl = null; }
  }
  if (typeof selectImpl !== "function") {
    throw new Error("set_hero_video: store unavailable — cannot reach the client's video store");
  }

  const slug = String(siteSlug || "").trim().toLowerCase();
  const found = await selectImpl(
    "ghost_agency_prospects",
    `?select=*&preview_url=ilike.*${encodeURIComponent(slug)}*&limit=25`,
  ).catch(() => null);
  const rows = found && found.ok === true && Array.isArray(found.data) ? found.data : [];
  const exact = rows.filter((r) => siteSlugFromRow(r) === slug);
  if (exact.length !== 1) {
    throw spokenRefusal(
      `set_hero_video: could not resolve exactly one video store for site '${slug}' (rows ${exact.length})`,
      "I couldn't reach this site's own video library, so I've stopped rather than guess. Nothing on your site changed — our team will get the video swap done directly.",
    );
  }
  const record = exact[0].record && typeof exact[0].record === "object" ? exact[0].record : {};
  const reel = record.media_bank && typeof record.media_bank === "object"
    ? record.media_bank.hero_reel
    : null;
  if (!reel || typeof reel !== "object" || !/^https:\/\//i.test(String(reel.url || ""))) {
    throw spokenRefusal(
      "set_hero_video: the client's store holds no approved generated hero clip yet",
      "There's no finished video in your library yet — these clips are generated for you, and once one is approved it lands in your library and I can put it straight onto your hero. I'm passing this to our team so a fresh video gets made. Nothing on your site changed.",
    );
  }
  const fault = seedanceProvenanceFault(reel);
  if (fault) {
    throw spokenRefusal(
      `set_hero_video: the stored clip fails its provenance gates (${fault})`,
      "The video in your library didn't pass our verification, so I'm not going to put it on your site. Nothing has changed — our team will sort the library out and get a good clip on there.",
    );
  }
  const provenance = reel.provenance;
  // The ONE identity a plan may name: an id or digest OF THIS STORE'S CLIP,
  // never an address. Anything else is refused rather than approximately
  // matched — "close" is how another business's clip ends up on this site.
  const want = String(requested || "").trim().toLowerCase();
  if (want && want !== "latest" && want !== "approved") {
    const identities = [
      String(provenance.hero_job_id || ""),
      String(provenance.provider_job_id || ""),
      String(provenance.output_sha256 || ""),
    ].map((v) => v.toLowerCase()).filter(Boolean);
    const hit = identities.some((id) => id === want
      || (/^[a-f0-9]{8,64}$/i.test(want) && id.startsWith(want)));
    if (!hit) {
      throw spokenRefusal(
        `set_hero_video: '${want.slice(0, 60)}' does not name this site's approved clip`,
        "That doesn't match the video in your library, so I've stopped rather than put the wrong clip on. Tell me you want the newest one and I'll swap that in.",
      );
    }
  }

  let res;
  try {
    res = await fetchImpl(String(reel.url), {
      headers: { "user-agent": "WSS-Labs-SiteEditor/1.0 (+https://wss-ai.com; attaches a client's own approved hero clip)" },
    });
  } catch (error) {
    throw new Error(`set_hero_video: could not download the approved clip (${String((error && error.message) || error).slice(0, 80)})`);
  }
  if (!res.ok) throw new Error(`set_hero_video: the clip store answered ${res.status}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) throw new Error(`set_hero_video: ${declared} bytes exceeds the ${maxBytes} cap`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error("set_hero_video: the clip store returned no bytes");
  if (bytes.length > maxBytes) throw new Error(`set_hero_video: ${bytes.length} bytes exceeds the ${maxBytes} cap`);
  // THE RECEIPT, RE-COMPUTED. The store saying "this is the approved clip"
  // is a claim; the hash of the actual bytes is the proof, and it has to
  // match the digest the worker recorded at approval time.
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!SHA256_RE.test(String(provenance.output_sha256 || "")) || sha256 !== String(provenance.output_sha256).toLowerCase()) {
    throw spokenRefusal(
      `set_hero_video: downloaded clip sha256 ${sha256.slice(0, 12)}… does not match the approved receipt`,
      "The video file in your library doesn't match the copy we approved, so I've stopped rather than put an unverified clip on your site. Nothing on your site changed — our team will refresh the library.",
    );
  }
  if (bytes.length < 16 || bytes.toString("latin1", 4, 8) !== "ftyp") {
    throw spokenRefusal(
      "set_hero_video: approved bytes are not an MP4 container",
      "The video in your library didn't come through as a playable clip, so I've stopped rather than ship it. Our team will re-render it.",
    );
  }
  return {
    bytes,
    sha256,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    provenance,
    clipRef: String(provenance.hero_job_id || ""),
    sourceUrl: String(reel.url),
  };
}

// ===========================================================================
// COPY CATALOG — the words a customer can actually see
// ===========================================================================
// "A Google Doc of copy changes" is a whole category in the support queue, and
// until now this system could not action a single line of it. replace_text
// edits index.html — and on these mirrors index.html contains none of the
// page's words. Measured on the live Rimrock mirror: every heading a visitor
// reads ("Three lines of everyday work.", "A small workshop, just for you.")
// lives in assets/index-PIV5JO_1.js as a plain double-quoted string literal.
// So a replace_text plan could apply cleanly, change bytes, pass every gate,
// and alter nothing the customer can see — the exact silent no-op this module
// was built to end.
//
// The catalog is built the same way the anchor catalog is, and for the same
// reason: the model picks an ID, the backend owns the string. It only offers
// literals that sit behind a CONTENT key (title:, children:, copy:, alt:, …),
// which is what separates the donor's prose from its Tailwind class lists and
// React's internal error text, and only ones that occur exactly once in the
// file, so "replace this" always has one answer.
const COPY_KEY = /\b(title|subtitle|sub|tag|label|eyebrow|heading|text|desc|description|body|blurb|copy|question|answer|children|alt|placeholder)\s*:\s*"((?:[^"\\\n]|\\.)*)"/g;
// Utility-class soup reads as prose to a naive filter ("mt-16 grid gap-12").
const LOOKS_LIKE_CLASSES = /(^|\s)(?:sm|md|lg|xl|2xl|hover|focus|group|peer)?:?-?(?:mt|mb|ml|mr|mx|my|pt|pb|px|py|gap|grid|flex|text|bg|font|border|rounded|w|h|max|min|inline|items|justify|absolute|relative|fixed|hidden|opacity|leading|tracking|z)-[a-z0-9[\]./-]+/i;

function decodeJsString(v) {
  return String(v)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, " ")
    .replace(/\\(.)/g, "$1");
}

/**
 * buildCopyCatalog(assetTexts, { max })
 * -> [{ id, file, key, text, chars }]
 */
function buildCopyCatalog(assetTexts = {}, { max = 60 } = {}) {
  const out = [];
  for (const rel of Object.keys(assetTexts).sort()) {
    if (!/\.js$/i.test(rel)) continue;
    const src = String(assetTexts[rel]);
    const seen = new Set();
    for (const m of src.matchAll(COPY_KEY)) {
      const literal = m[2];
      const text = decodeJsString(literal);
      if (text.length < 8 || text.length > 300) continue;
      if (!/\s/.test(text) || !/[a-z]/.test(text)) continue;
      if (!/^[A-Za-z"'“(]/.test(text)) continue;
      if (LOOKS_LIKE_CLASSES.test(text)) continue;
      if (/[<>{}]|https?:|\/assets\//.test(text)) continue;
      if (seen.has(literal)) continue;
      seen.add(literal);
      // Uniqueness is the whole safety property of the replace: a literal that
      // appears twice has two answers to "change this one".
      if (src.split(`"${literal}"`).length - 1 !== 1) continue;
      out.push({ id: `t${out.length + 1}`, file: rel, key: m[1], literal, text, chars: text.length });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Rewrite the CONTENTS of one string constant, and nothing else.
 *
 * The replacement is refused if it carries a quote, a backslash, a newline or
 * an angle bracket — the four things that would let a string escape its own
 * literal and become code. With those excluded, this edit provably cannot
 * change the program: it substitutes bytes strictly between two quote
 * characters that are already there.
 */
function applyCopyReplace(bundleText, { literal, replacement }) {
  const needle = `"${literal}"`;
  const count = String(bundleText).split(needle).length - 1;
  if (count !== 1) throw new Error(`replace_copy: that wording occurs ${count} times in the page code, refusing to guess which`);
  if (/["\\\n\r<>]/.test(replacement)) {
    throw new Error('replace_copy: new wording may not contain quotes, backslashes, angle brackets or line breaks');
  }
  return String(bundleText).replace(needle, `"${replacement}"`);
}

/** The bundle is writable ONLY where the copy catalog said it was. */
function assertBundleInScope(rel, allowedBundles) {
  const name = String(rel || "").trim();
  if (!allowedBundles.has(name)) throw new Error(`out of scope: '${name}' is not this site's compiled bundle`);
  return name;
}

// ===========================================================================
// COPY BLOCKS — new prose, without handing the planner a markup pen
// ===========================================================================
// insert_html still exists and still refuses script/iframe/handlers, but it
// takes raw HTML, which means the planner is authoring markup every time a
// customer wants a paragraph added. copy_block takes STRUCTURE — a heading,
// paragraphs, bullets — and this file renders it, escaped, into the site's own
// content classes. The planner cannot emit a tag at all, so there is nothing
// to sanitise, and the block matches the page instead of approximating it.
function renderCopyBlock({ heading, paragraphs = [], bullets = [], jobId }) {
  const h = String(heading || "").trim();
  const ps = (Array.isArray(paragraphs) ? paragraphs : [paragraphs]).map((p) => String(p || "").trim()).filter(Boolean);
  const lis = (Array.isArray(bullets) ? bullets : []).map((b) => String(b || "").trim()).filter(Boolean);
  if (!h && !ps.length && !lis.length) throw new Error("copy_block: nothing to add");
  const id = `wss-block-${String(jobId).replace(/[^a-z0-9]+/gi, "").slice(-8)}`;
  return [
    `<section class="wss-c" data-wss-edit="${esc(jobId)}"${h ? ` aria-labelledby="${id}"` : ""}>`,
    `<div class="wss-c__inner">`,
    h ? `<div class="wss-c__rule"></div>\n<h2 id="${id}">${esc(h)}</h2>` : "",
    ...ps.map((p) => `<p>${esc(p)}</p>`),
    lis.length ? `<ul class="wss-c__areas">${lis.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "",
    `</div>`,
    `</section>`,
  ].filter(Boolean).join("\n");
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ===========================================================================
// LEGAL PAGES — may we generate one at all?
// ===========================================================================
// The standing rule in this system is that an SEO page for a service the
// business does not offer is a lie, so pages are generated only from the
// client's verified packet. A privacy policy looks like it breaks that rule,
// so it is worth being precise about why it does not.
//
// THE DISTINCTION IS WHAT THE PAGE IS ABOUT.
// A service page makes assertions about the BUSINESS — what it does, where it
// works, what it is qualified to do. We cannot source those, so we refuse them.
// A privacy policy of the kind generated here makes assertions about THIS
// WEBSITE — what scripts it loads, which third parties those scripts contact,
// what a visitor's browser is asked to store. That is not a claim about the
// customer's trade. It is a description of an artifact WE built, whose bytes
// are sitting in front of us as we write the page, and every sentence below is
// derived from those bytes: the tracking inventory is read out of the deployed
// HTML by readInstalledTags(), the font and media origins are matched in the
// shipped files, the contact routes come from the same verified facts every
// other page uses. This is the one page on the site where we are the primary
// source. So the truth law is not being bent for convenience — it is being
// satisfied more strictly than usual, because the evidence is first-hand.
//
// WHAT IS STILL REFUSED, AND WHY IT MATTERS MORE THAN WHAT IS ALLOWED.
//   - No statement of legal compliance. Not "GDPR compliant", not "CCPA
//     compliant", not "meets applicable law". Compliance is a conclusion about
//     the whole business — its CRM, its call recordings, its paper files —
//     none of which we can see. Claiming it would be the single most dangerous
//     sentence this system could publish.
//   - No promises about conduct. Not "personal information is never sold",
//     not "data is deleted after N days", not "requests are answered within a
//     week". Those are commitments the business has not made and we cannot
//     keep on its behalf.
//   - No rights we cannot execute. A deletion or access right described on the
//     page has to be honoured by somebody; the page therefore routes people to
//     the business on its own published phone and email, and says nothing about
//     what will happen when they get there.
//   - NO TERMS OF SERVICE. A privacy policy describes; a terms of service
//     BINDS — it is a contract offered to the public in the customer's name,
//     setting liability, warranty and dispute terms nobody has agreed to.
//     Generating one is drafting a contract for a stranger. legal_page refuses
//     "terms" explicitly rather than quietly not supporting it, so the refusal
//     is a sentence Riley says instead of a silent gap.
//
// The result is a page that is short, accurate, and dated — and honest about
// being a description rather than a legal instrument. It is the correct
// default for a site that has just had a Google Tag Manager container
// installed on it, which is exactly when customers ask for one.
const LEGAL_KINDS = Object.freeze({
  privacy: { route: "/privacy", rel: "privacy.html", label: "Privacy", title: "Privacy" },
});

// MEASURED ON THE FIRST LIVE RENDER, not anticipated. The inherited sub-page
// stylesheet styles anchors only in four specific places — .wss-p__bar a,
// .wss-p__cite a, .wss-c__nearlist a and a.wss-p__cta — and declares nothing
// for a bare <a> in body copy. renderSeoPage() never noticed because both its
// links happen to sit in styled classes. A privacy page is mostly prose with
// links IN the prose (each vendor's own notice, the business's phone and
// email), so on the first deploy every one of them rendered in the browser's
// default blue on this donor's near-black background: legible only if you
// already knew it was there. A legal page whose links cannot be seen is a
// legal page that does not work, so the page carries the rule itself rather
// than depending on what the donor's stylesheet happens to cover.
const LEGAL_PAGE_CSS = `<style>
.wss-c a{color:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)));text-underline-offset:3px}
.wss-c a:hover{text-decoration:none}
.wss-c code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;letter-spacing:0}
.wss-c__table th[scope=row]{white-space:nowrap}
.wss-c h3{margin-top:1.4rem}
</style>`;

/** Lift the site's own sub-page stylesheet so the page looks like the site. */
function extractSiteStyle(aboutHtml, indexHtml) {
  const m = String(aboutHtml || "").match(/<style>[\s\S]*?<\/style>/i)
    || String(indexHtml || "").match(/<style>[\s\S]*?<\/style>/i);
  // A mirror with no sub-page stylesheet still gets a readable page rather
  // than a failed job; legibility is not worth refusing a legal page over.
  return m ? m[0] : "<style>body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;max-width:44rem;margin:0 auto;padding:2rem 1.25rem}</style>";
}

// The static sub-page stylesheet colours everything from --accent, so a
// generated page that does not carry the site's own palette renders in that
// stylesheet's fallback blue — a colour that belongs to no customer.
//
// MEASURED ON THE LIVE RIMROCK MIRROR, and the reason this is not simply a
// copy of lib/seo-page-edit.js brandAccentOverride(): that helper reads hex
// values out of index.html, and this mirror declares nothing of the sort.
// index.html carries one custom property — `--wss-a: var(--accent,199 89% 48%)`,
// i.e. a reference to the fallback — while the real palette lives in
// assets/index-DPiwUvaU.css as `--accent: 36 97% 62%`, an HSL TRIPLE rather
// than a hex. A hex-only reader of index.html alone therefore finds nothing on
// every mirror in this lane and silently ships the blue. So this searches the
// compiled stylesheet too, and accepts a triple as readily as a hex.
function brandAccentBlock(cssSources) {
  const src = String(cssSources || "");
  const read = (name) => {
    const triple = src.match(new RegExp(`${name}\\s*:\\s*(\\d{1,3}\\s+\\d{1,3}%\\s+\\d{1,3}%)`, "i"));
    if (triple) return { triple: triple[1].replace(/\s+/g, " ") };
    const hex = src.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{3,8})`, "i"));
    return hex ? { hex: hex[1] } : null;
  };
  const found = ["--accent", "--brand", "--primary"].map(read).find(Boolean);
  if (!found) return "";
  if (found.triple) return `<style>/* brand palette, read from the site's own custom properties */\n:root{--accent:${found.triple}}\n</style>`;
  const raw = found.hex.replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return "";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `<style>/* brand palette, read from the site's own custom properties */\n:root{--accent:${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%}\n</style>`;
}

// ===========================================================================
// RESTYLE_SITE — "change the colour of my whole site", as one verb
// ===========================================================================
// style_override recolours ONE ELEMENT, and its selector set is deliberately
// closed: every selector must come from the element catalog, and :root is not
// in it. That rail is what makes a style rule unable to miss — and it is also
// why a caller asking for a whole-site repaint ("change the colour of my whole
// site to green") had no verb at all: the honest answer was always the refusal,
// for the most common paint request there is.
//
// The site already carries the machinery this needs — its own palette. These
// builds drive their colour from CSS custom properties declared on :root
// (--primary, --accent, --brand; that is what brandAccentBlock() above reads,
// and what lib/mirror-engine/theme.js recolours at build time), and an
// UNLAYERED <style> block outranks the layered declarations that first set
// them — the same cascade fact the h1 entry in the element catalog is built
// on. So a whole-site recolour is a :root token override, and every token it
// names is one THE SITE ITSELF declares, discovered from the bytes about to be
// deployed rather than from a vocabulary we typed:
//
//   · a token the site does not declare is not written. The override speaks
//     the site's own vocabulary or it says nothing.
//   · each value is written in the FORMAT the site declared — hex stays hex,
//     an HSL triple stays a triple — because both `hsl(var(--accent))` and
//     `var(--accent)` are real on this fleet, and the wrong format is a
//     silently unpainted site.
//   · ink tokens that sit ON the accent (--accent-ink, --primary-foreground)
//     flip dark or light with the new colour's luminance, so a pale accent
//     does not ship white-on-yellow buttons — the "it applied and it looks
//     broken" failure this module exists to refuse.
//   · a site that declares none of the palette tokens paints its colour in
//     baked literals, and gets a spoken refusal — an honest bigger-build
//     sentence — rather than an override that cannot reach the page.
//
// VERIFICATION rides the existing rendered check untouched: a custom property
// IS a property, :root IS an element, and declaredIntents() + measureInPage()
// already read computed values back off the live page — the computed value of
// the token is exactly the string we wrote. The rebuild replay is the
// style_override lane, which re-injects raw CSS verbatim into <head>: the same
// bytes, the same spot, no second replay implementation to drift.

// Spoken colour words the planner may pass through instead of a hex. A fixed
// table, not colour maths — "navy" is a decision, not a wavelength.
const RESTYLE_NAMED_COLORS = Object.freeze({
  orange: "#f97316", red: "#dc2626", blue: "#2563eb", green: "#16a34a",
  purple: "#7c3aed", yellow: "#facc15", gold: "#d4a017", navy: "#1e3a8a",
  teal: "#0d9488", pink: "#db2777", black: "#111827", white: "#f9fafb",
  grey: "#6b7280", gray: "#6b7280",
});

/** "#0f0" / "#44aa00" / "green" -> "#44aa00", or null when it is no colour. */
function normalizeRestyleColor(raw) {
  let v = String(raw == null ? "" : raw).trim().toLowerCase();
  if (RESTYLE_NAMED_COLORS[v]) v = RESTYLE_NAMED_COLORS[v];
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${hex}`;
}

/** WCAG relative luminance — the number the ink flip is decided on. */
function relativeLuminance(hex) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// The palette vocabulary this verb speaks, and where the ink sits. Deliberately
// NOT including bare "--ink"/"--background"/"--foreground": those carry body
// text and page ground on several donors, and repainting them from one accent
// colour is how a site ends up white-on-white. Accent + primary + brand is the
// honest reach of "change my colour".
const RESTYLE_PALETTE_TOKENS = Object.freeze(["--accent", "--primary", "--brand"]);
const RESTYLE_INK_TOKENS = Object.freeze(["--accent-ink", "--primary-foreground"]);
const restyleValueRe = (token) => new RegExp(`(?<![\\w-])${token}\\s*:\\s*(#[0-9a-fA-F]{3,8}|\\d{1,3}\\s+\\d{1,3}%\\s+\\d{1,3}%)`);

/**
 * detectRestyleTokens(cssSources)
 *   -> { palette: [{token, format, declared}], ink: [...] }
 *
 * `cssSources` is every CSS-bearing byte about to be deployed — the HTML shell
 * (inline <style> blocks) plus the compiled bundle. The first declaration wins,
 * shell before bundle, which matches where the cascade reads it from.
 */
function detectRestyleTokens(cssSources) {
  const src = String(cssSources || "");
  const find = (token) => {
    const m = src.match(restyleValueRe(token));
    return m ? { token, format: m[1].startsWith("#") ? "hex" : "triple", declared: m[1] } : null;
  };
  return {
    palette: RESTYLE_PALETTE_TOKENS.map(find).filter(Boolean),
    ink: RESTYLE_INK_TOKENS.map(find).filter(Boolean),
  };
}

/** Write a colour in the token's own declared format, never a guessed one. */
function restyleValueFor(format, hex) {
  return format === "hex" ? hex : hexToHslTriple(hex);
}

/**
 * buildRestyleCss({ color, cssSources })
 *   -> { color, css, declarations, tokens, notes }
 *   throws a spokenRefusal when the colour is unreadable or the site has no
 *   palette to repaint — both are refusals the caller can hear, raised before
 *   a byte moves.
 */
function buildRestyleCss({ color, cssSources } = {}) {
  const hex = normalizeRestyleColor(color);
  if (!hex) {
    throw spokenRefusal(
      `restyle_site: '${String(color == null ? "" : color).slice(0, 40)}' is not a colour this verb can paint with`,
      "I couldn't read that as a colour. Give it to me in your own words — green, navy, orange — or as a hex code, and I'll repaint the whole site with it.",
    );
  }
  const found = detectRestyleTokens(cssSources);
  if (!found.palette.length) {
    throw spokenRefusal(
      "restyle_site: this site declares no palette custom properties to recolour",
      "This site's colours are painted the hard way — baked into the page rather than set from a palette — so I can't repaint the whole thing in one go. Name the specific bits you'd like changed and I'll take them one at a time, and I'll flag the full repaint for our team.",
    );
  }
  // Ink flips at 0.5 luminance: below it white ink still clears contrast, at
  // or above it the accent is pale enough that ink goes dark. A token whose
  // declared value ALREADY equals the ink the new colour calls for is not
  // restated — the block touches exactly the tokens the repaint moves, and the
  // note below says "flipped" only when something actually did.
  const inkHex = relativeLuminance(hex) > 0.5 ? "#111827" : "#ffffff";
  const inkTriple = hexToHslTriple(inkHex);
  const declaredTriple = (t) => (t.format === "hex"
    ? hexToHslTriple(t.declared)
    : String(t.declared).replace(/\s+/g, " ").trim());
  const inkMoves = found.ink.filter((t) => declaredTriple(t) !== inkTriple);
  const declarations = [
    ...found.palette.map((t) => `${t.token}: ${restyleValueFor(t.format, hex)}`),
    ...inkMoves.map((t) => `${t.token}: ${restyleValueFor(t.format, inkHex)}`),
  ];
  return {
    color: hex,
    css: `:root { ${declarations.join("; ")}; }`,
    declarations: declarations.join("; "),
    tokens: [...found.palette, ...inkMoves].map((t) => t.token),
    notes: inkMoves.length ? ["ink_tokens_flipped_for_contrast"] : [],
  };
}

/**
 * observeSiteDataSurfaces({ fileTexts, assetTexts })
 *
 * Everything the privacy page is permitted to describe, read off the bytes
 * about to be deployed. Nothing here is inferred from what a mirror USUALLY
 * has — a surface that is not found is not mentioned, and the page says less.
 */
function observeSiteDataSurfaces({ fileTexts = {}, assetTexts = {} } = {}) {
  // THE PAGE MUST NOT OBSERVE ITSELF. The generated legal page carries the
  // business's phone and email as tel:/mailto: links in its own contact line,
  // so scanning it as evidence makes "this site has contact links" true because
  // the page saying so exists. Caught by an idempotence test: refreshing the
  // page fed its own output back and produced a DIFFERENT page each time, which
  // is the visible symptom of a self-referential fact. On these mirrors the
  // claim happens to be true anyway — but "true by accident" is how a site with
  // no contact links would end up with a page insisting it has some.
  const generated = new Set(Object.values(LEGAL_KINDS).map((k) => k.rel));
  const shell = Object.entries(fileTexts)
    .filter(([rel]) => !generated.has(rel))
    .map(([, v]) => String(v))
    .join("\n");
  const all = `${shell}\n${Object.values(assetTexts).map(String).join("\n")}`;
  return {
    tags: readInstalledTags(fileTexts["index.html"] || ""),
    googleFonts: /fonts\.(googleapis|gstatic)\.com/i.test(all),
    maps: /maps\.(googleapis|google)\.com|api\.mapbox\.com|maps\.apple\.com/i.test(all),
    // A <form> is only claimed when one is really there. On a compiled mirror
    // the element is created by the bundle, so the React factory calls are
    // checked as well as the literal tag.
    //
    // This test used to be the looser /["']form["']\s*,/ and it was WRONG for a
    // reason worth keeping visible: on the Rimrock bundle that pattern's first
    // hit is `a.setAttribute("form", e.id)` inside React's own DOM shim — a
    // string that has nothing to do with the page having a form. It happened to
    // return the right answer there (the donor does render `jsxs("form",…)`),
    // which is the most dangerous kind of wrong: a detector that is broken and
    // agrees with you. On a donor with no form it would have put "This site has
    // a contact form" onto a privacy page, which is a fabricated statement
    // about a customer's site. Only a real element construction counts now.
    form: /<form[\s>]/i.test(shell) || /(?:jsxs?|createElement)\(\s*["']form["']/.test(all),
    tel: /href=["']tel:|["']tel:/i.test(all),
    email: /mailto:/i.test(all),
  };
}

/**
 * A tracking identifier, in a form that is safe to print as visible text.
 *
 * A Meta pixel ID is 15-16 bare digits, and the shared claim gate
 * (lib/seo-page-edit.js assertNoInventedClaims) refuses any page carrying a
 * phone-shaped run that is not the business's own number. Its pattern has no
 * boundary, so it matches the first ten digits of a sixteen-digit pixel ID and
 * refuses the page. Caught by the test below, not in production: every customer
 * running a Meta pixel would have been unable to get a privacy page at all.
 *
 * That is a false positive in the gate — a sixteen-digit run is not a phone
 * number — and the right repair is a word boundary in that regex, in that file.
 * It is flagged rather than reached for here, because widening a truth gate is
 * not a change to make as a side effect of shipping a feature, and this module
 * has an honest alternative: print what a reader can actually use. The vendor
 * and the last four digits identify WHICH pixel without reproducing a
 * phone-shaped run, and the full ID is in the page source where a technical
 * reader looks for it anyway. Prefixed IDs (GTM-, G-, AW-) are never
 * phone-shaped and print in full.
 */
function printableTagId(id) {
  const raw = String(id || "");
  return /^\d{7,}$/.test(raw) ? `ending ${raw.slice(-4)}` : raw;
}

/**
 * The generated privacy page.
 *
 * Third person throughout, deliberately. The page is not the business
 * speaking; it is a description of the website attached to the business, and
 * assertNoInventedClaims() enforces that by refusing first-person pronouns —
 * the same gate every generated page in this system passes.
 */
function renderPrivacyPage({ facts, observations, today, styleBlock, accentBlock, route }) {
  const url = `${facts.origin}${route}`;
  const telHref = `tel:${String(facts.phone).replace(/[^\d+]/g, "")}`;
  const host = facts.host || String(facts.origin || "").replace(/^https?:\/\//, "");
  const name = facts.businessName;

  const collects = [];
  if (observations.form) {
    collects.push(`This site has a contact form. What a visitor types into it is sent to ${name} so that the enquiry can be answered.`);
  } else {
    collects.push(`This site has no sign-up, no account and no login, and it does not ask a visitor to type anything into it.`);
  }
  if (observations.tel || observations.email) {
    const routes = [observations.tel ? "a phone dialler" : "", observations.email ? "an email app" : ""].filter(Boolean).join(" or ");
    collects.push(`The contact links open ${routes}. A call or a message started that way goes to ${name} directly and is not recorded by this website.`);
  }

  const tagRows = observations.tags
    .map((t) => ({ t, spec: TRACKING_VENDORS[t.key] }))
    .filter((x) => x.spec);

  const thirdParties = [];
  if (observations.googleFonts) thirdParties.push(["Google Fonts", "serves the typefaces this page is set in, so Google receives the request that loads them"]);
  if (observations.maps) thirdParties.push(["A mapping service", "draws the map shown on the page, so the map provider receives the request that loads it"]);

  const sections = [];

  sections.push(`<h2>What this website collects</h2>\n${collects.map((c) => `<p>${esc(c)}</p>`).join("\n")}`);

  if (tagRows.length) {
    sections.push(
      `<h2>Measurement and advertising tags</h2>`
      + `<p>${esc(`The following tags are installed on the pages of this site. Each is supplied by the company named, and what it records is determined by that company and by the account it reports into, not by this page.`)}</p>`
      + `<table class="wss-c__table"><thead><tr><th scope="col">Tag</th><th scope="col">Identifier</th><th scope="col">What it does here</th></tr></thead><tbody>`
      + tagRows.map(({ t, spec }) =>
        `<tr><th scope="row">${esc(spec.label)}</th><td><code>${esc(printableTagId(t.id))}</code></td><td>${esc(spec.describes)}</td></tr>`).join("")
      + `</tbody></table>`
      + `<p>${esc("Each provider publishes its own privacy notice:")} ${tagRows.map(({ spec }) =>
        `<a href="${esc(spec.privacyUrl)}" target="_blank" rel="noopener noreferrer nofollow">${esc(spec.label)}</a>`).join(" · ")}</p>`
      + `<h3>Cookies</h3><p>${esc("A tag listed above may store a small file — a cookie — in the browser so that repeat visits can be recognised. Browsers can block or clear cookies in their own settings, and a browser's do-not-track or tracking-protection setting applies to these tags in the usual way.")}</p>`,
    );
  } else {
    sections.push(
      `<h2>Measurement and advertising tags</h2>`
      + `<p>${esc("No analytics or advertising tags are installed on this site, so none of the cookies those tags rely on are set by these pages.")}</p>`,
    );
  }

  if (thirdParties.length) {
    sections.push(
      `<h2>Other services these pages load</h2>`
      + `<ul>${thirdParties.map(([who, what]) => `<li><strong>${esc(who)}</strong> — ${esc(what)}</li>`).join("")}</ul>`
      + `<p>${esc("Loading any file from another company's server necessarily tells that company the request happened, including the visiting browser's address. That is a property of how the web works rather than a choice made on this page.")}</p>`,
    );
  }

  sections.push(
    `<h2>Questions about this page</h2>`
    + `<p>${esc(`Anything on this page can be raised with ${name} directly.`)}</p>`
    + `<p>${esc(name)} · <a href="${esc(telHref)}">${esc(facts.phone)}</a>${facts.email ? ` · <a href="mailto:${esc(facts.email)}">${esc(facts.email)}</a>` : ""} · ${esc(facts.serves || `${facts.city}, ${facts.state}`)}</p>`,
  );

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${facts.origin}/` },
          { "@type": "ListItem", position: 2, name: "Privacy", item: url },
        ],
      },
      {
        "@type": "WebPage",
        name: `Privacy — ${name}`,
        url,
        inLanguage: "en",
        dateModified: today,
        isPartOf: { "@type": "WebSite", url: `${facts.origin}/`, name },
        about: { "@type": "Thing", name: "Website privacy information" },
        publisher: {
          "@type": "LocalBusiness",
          name,
          telephone: facts.phone,
          url: `${facts.origin}/`,
          ...(facts.address ? { address: { "@type": "PostalAddress", streetAddress: facts.address } } : {}),
        },
      },
    ],
  };

  const title = `Privacy — ${name}`;
  const description = `What the ${name} website at ${host} does with information from the people who visit it.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="index,follow" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${esc(url)}" />

${styleBlock}
${accentBlock}
${LEGAL_PAGE_CSS}
</head>
<body>
<header class="wss-p__bar">
  <a href="/">${esc(name)}</a>
  <nav><a href="/">Home</a><a href="/about">About</a><a href="${esc(route)}">Privacy</a><a href="${esc(telHref)}">${esc(facts.phone)}</a></nav>
</header>
<main id="main">
<p class="wss-p__crumbs"><a href="/" style="color:inherit">Home</a> › Privacy</p>
<section class="wss-c"><div class="wss-c__inner">
<p class="wss-c__eyebrow">Privacy</p><div class="wss-c__rule"></div>
<h1>Privacy</h1>
<p>${esc(`This page describes what the ${name} website at ${host} does with information from the people who visit it. It covers this website only, and it is a description of how these pages are built rather than a legal agreement.`)}</p>
${sections.join("\n")}
</div></section>
<p class="wss-p__meta">Last updated ${esc(today)}</p>
</main>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</body>
</html>
`;
}

/**
 * The bottom-of-page legal strip.
 *
 * "Link privacy policy in footer" is a support ticket in its own right, and on
 * these compiled mirrors the footer is drawn by the JS bundle — there is no
 * <footer> in index.html to insert into, and rewriting a React component tree
 * from a plan is exactly the whole-file regeneration this module exists to
 * avoid. So the link goes in a self-contained strip appended at the end of
 * <body>, which the browser lays out below everything the app rendered: the
 * bottom of the page, which is where a reader looks for it and where a crawler
 * finds it. It inherits colour from the page rather than choosing one, so it
 * cannot clash with a palette it has not seen.
 */
function applyLegalStrip(html, { links, jobId }) {
  const marker = `<!-- wss-legal ${jobId} -->`;
  const rows = links.map(({ route, label }) => `<a href="${esc(route)}" style="color:inherit;text-decoration:underline">${esc(label)}</a>`).join(" · ");
  const existing = String(html).match(/<div data-wss-legal[\s\S]*?<\/div>/i);
  const strip = `${marker}\n<div data-wss-legal="1" style="padding:14px 20px;text-align:center;font:400 13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;opacity:.72">${rows}</div>`;
  if (existing) return String(html).replace(existing[0], strip.replace(`${marker}\n`, ""));
  const at = String(html).lastIndexOf("</body>");
  if (at < 0) throw new Error("legal_page: index.html has no </body> to attach the footer link to");
  return html.slice(0, at) + `${strip}\n` + html.slice(at);
}

/**
 * Keep an existing privacy page TRUE after the tag inventory changes.
 *
 * The page says, in as many words, "the following tags are installed on the
 * pages of this site". Installing a tag afterwards makes that sentence false —
 * and it is the one page on the site whose entire justification is that every
 * statement on it is derived from bytes we can point at. Measured on the live
 * mirror: a Meta pixel added after the page existed left the page listing only
 * Google Tag Manager, which is a page that misdescribes what the site does with
 * visitor data. A generated page that can go stale is a generated lie on a
 * delay, so the tag op refreshes it in the same job.
 *
 * The page is machine-owned and deterministic, so regenerating it is safe: the
 * only inputs are the site's own facts and its own observed surfaces.
 */
function refreshPrivacyPage({ fileTexts, assetTexts, facts, today }) {
  const rel = LEGAL_KINDS.privacy.rel;
  const current = fileTexts[rel];
  if (!current) return null;
  const observations = observeSiteDataSurfaces({ fileTexts, assetTexts });
  let next = renderPrivacyPage({
    facts,
    observations,
    today,
    styleBlock: extractSiteStyle(fileTexts["about.html"], fileTexts["index.html"]),
    accentBlock: brandAccentBlock([
      fileTexts["index.html"] || "",
      ...Object.entries(assetTexts).filter(([r]) => /\.css$/i.test(r)).map(([, v]) => v),
    ].join("\n")),
    route: LEGAL_KINDS.privacy.route,
  });
  for (const t of observations.tags) {
    const known = TRACKING_VENDORS[t.key];
    if (known) next = installTrackingTag(next, { key: t.key, spec: known, id: t.id }).html;
  }
  assertNoInventedClaims(next, facts);
  return next === current ? null : next;
}

/** Every legal route already linked in the strip, so a second one appends. */
function readLegalStripLinks(html) {
  const block = String(html || "").match(/<div data-wss-legal[\s\S]*?<\/div>/i);
  if (!block) return [];
  return [...block[0].matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map((m) => ({ route: m[1], label: m[2] }));
}

// ---------------------------------------------------------------------------
// Reversibility
// ---------------------------------------------------------------------------
// ===========================================================================
// READ-AFTER-WRITE — the silent rollback
// ===========================================================================
// MEASURED, 2026-08-07, on the live Rimrock mirror. Three edits were applied
// in sequence: swap a photo, re-word a heading, add a block. Each reported
// success and each verified at the time. At the end, the live site had NONE of
// the first two: the photo was back to the donor's original and the heading was
// back to its old wording, while the archive held a bundle carrying the
// re-wording but not the photo swap.
//
// Nothing was wrong with the edits. The archive is fronted by an edge cache —
// a plain object GET comes back `cf-cache-status: HIT` with the PREVIOUS bytes,
// even though the response says `cache-control: no-cache`. Measured directly:
// write, then read four times, and all four reads returned the prior value.
//
// That is fatal for this design, because every edit in this system rebuilds
// the WHOLE deploy from the archive and pushes all of it. So an edit that
// reads one stale file does not merely miss an update — it writes the stale
// copy back and redeploys it, silently reverting a change a customer was told
// was live. It is the same species of failure as the cached email thumbnail:
// the artifact was correct and the thing that served it was not.
//
// A cache-busting query defeats it: the same three writes read back FRESH
// (cf-cache-status: MISS) 3/3 with a unique parameter. So every archive read on
// this path goes through here. lib/site-editor.js download() is the shared
// client and is not this change's to alter, so the busted read is defined
// beside the code that depends on it; the one-line fix belongs upstream and is
// flagged rather than smuggled in.
async function downloadFresh(prefix, rel) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const bust = `wssfresh=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${url}/storage/v1/object/wss-site-sources/${prefix}/${rel}?${bust}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key, "cache-control": "no-cache" },
  });
  if (!res.ok) throw new Error(`download failed ${rel}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Read back what we just wrote and prove it is what we sent.
 *
 * "QC PASS is never proof" applies to our own uploads. An upload that returns
 * 200 and an object that actually holds those bytes are different claims, and
 * the gap between them is exactly the rollback above. This closes the loop
 * before the deploy, so a job fails loudly instead of a customer being told a
 * change is live that the archive never took.
 */
async function assertArchiveMatches(siteSlug, rel, expected) {
  const got = await downloadFresh(siteSlug, rel);
  if (!got.equals(expected)) {
    throw new Error(
      `archive readback mismatch for ${rel}: wrote ${expected.length} bytes, read back ${got.length}. `
      + "Refusing to deploy — the stored copy is not the edited copy.",
    );
  }
  return true;
}

// ===========================================================================
// STALE-BASE GUARD — the last-write-wins clobber, closed at the source
// ===========================================================================
// MEASURED IN PRODUCTION, 2026-08-10→11 (Air Creation): four edit jobs fired
// ~68 seconds apart, against an apply+deploy window measured north of 60s. Job
// N+1's archive READ began before job N's WRITE landed, and because every edit
// here publishes the WHOLE site from what it read, N+1's deploy put N's bytes
// (and N-1's) back. Two changes the caller had SEEN went away; the change the
// caller was asking about never appeared. Last-write-wins at full-site
// granularity: rapid successive edits could not accumulate.
//
// The per-site lease in lib/edit-job-runner.js is the primary defense: job
// N+1 cannot start reading until job N's deploy, rendered verification and
// terminal write are all done. THIS guard is the defense in depth inside the
// engine itself, because the engine is what publishes and the engine must
// refuse to publish from bytes it cannot prove current:
//
//   1. at the top of the run, read the site's write marker (the _undo manifest
//      every apply rewrites — it IS a per-site revision record already);
//   2. read the archive, plan, apply in memory;
//   3. immediately BEFORE the first upload, re-read the marker. If it moved,
//      another writer touched this site while we worked, and the base we
//      planned against is stale. THROW before a single byte is uploaded.
//
// Fail-safe by construction: the throw is pre-upload, so nothing can be
// published from a stale base; the runner (edit-job-runner.js) turns the named
// `stale_site_base` code into a requeue-and-retry on a fresh base rather than a
// terminal failure. The marker carries a monotonic `rev` (written by
// snapshot(), serialized per site by the lease) so the comparison does not
// depend on clock agreement between lambdas; legacy manifests without `rev`
// are identified by (taken_at, job_id), and any legacy→rev transition — which
// can only mean another writer — reads as stale, fail-safe.
async function readManifestMarker(loadManifest) {
  try {
    const raw = await loadManifest();
    const manifest = JSON.parse(raw.toString("utf8"));
    if (!manifest || typeof manifest !== "object") return null;
    return {
      rev: Number.isFinite(manifest.rev) ? manifest.rev : null,
      taken_at: typeof manifest.taken_at === "string" ? manifest.taken_at : null,
      job_id: typeof manifest.job_id === "string" ? manifest.job_id : null,
    };
  } catch (error) {
    // A site that has never been edited has no manifest: that is "no writes
    // seen", not an error. Anything else (store down, corrupt bytes) must stop
    // the run rather than read as "nothing changed" — a marker we cannot read
    // is exactly the situation this guard exists for.
    const status = Number(/: (\d{3})\s*$/.exec(String((error && error.message) || error || ""))?.[1]);
    if (status === 404) return null;
    throw error;
  }
}

async function defaultReadSiteWriteMarker(siteSlug) {
  return readManifestMarker(() => downloadFresh(`${UNDO_PREFIX}/${siteSlug}`, "latest.json"));
}

/** The identity of a site's write state, in one comparable string. */
function siteMarkerIdentity(marker) {
  if (!marker) return "none";
  if (Number.isFinite(marker.rev)) return `rev:${marker.rev}`;
  return `legacy:${marker.taken_at || "unknown"}:${marker.job_id || "unknown"}`;
}

/** The stale-base decision, factored out so a test can hold the line directly:
 *  the base this run read at the start must still be the site's current write
 *  state at upload time. */
function assertFreshBase(baseMarker, currentMarker) {
  const base = siteMarkerIdentity(baseMarker);
  const current = siteMarkerIdentity(currentMarker);
  if (base !== current) {
    throw Object.assign(
      new Error(
        `stale_site_base: the site was written by another job while this edit was being prepared `
        + `(base ${base}, current ${current}). Refusing to publish from a stale base.`,
      ),
      { code: "stale_site_base", machinery: true, staleBase: { base: baseMarker, current: currentMarker } },
    );
  }
  return true;
}

// Undoing a CREATED file means removing it, and nothing else in this system
// has ever needed to delete from the archive. The storage client in
// lib/site-editor.js is imported by four modules and is not this change's to
// widen for one caller, so the single DELETE this planner can ever issue lives
// here, next to the code that decides to issue it. It is reachable only from
// applyUndo, only for paths a snapshot manifest recorded as created by a
// previous plan on THIS slug — never from a plan op, and never for a path a
// caller named.
async function removeArchivedObject(siteSlug, rel) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const res = await fetch(`${url}/storage/v1/object/wss-site-sources/${siteSlug}/${rel}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  // A file that is already gone is the state we wanted; only a real failure
  // should stop an undo the caller is waiting on.
  if (!res.ok && res.status !== 404) throw new Error(`undo: could not remove ${rel} (${res.status})`);
  return true;
}

async function snapshot({ siteSlug, jobId, originals, created = [], rev = null }) {
  const prefix = `${UNDO_PREFIX}/${siteSlug}/${jobId}`;
  const rels = Object.keys(originals);
  for (const rel of rels) await upload(prefix, rel, originals[rel]);
  // `created` carries no bytes because there are none to keep — the undo for a
  // file that did not exist is its absence. Recording the NAMES is what makes
  // that undo possible at all: without this list, "add a privacy page" would
  // be the one change in this system that cannot be taken back, because
  // restoring index.html would remove the link while /privacy kept serving.
  //
  // `rev` is the per-site write counter (base marker + 1) that the stale-base
  // guard compares on the NEXT edit; monotonic per site, written under the
  // per-site lease, so the guard's comparison never depends on clock skew.
  const manifest = {
    site_slug: siteSlug,
    job_id: jobId,
    files: rels,
    created,
    ...(Number.isFinite(rev) ? { rev } : {}),
    taken_at: new Date().toISOString(),
  };
  await upload(prefix, "manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), "application/json");
  await upload(`${UNDO_PREFIX}/${siteSlug}`, "latest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), "application/json");
  return manifest;
}

async function loadUndo({ siteSlug, jobId }) {
  const base = `${UNDO_PREFIX}/${siteSlug}`;
  let manifest;
  try {
    const raw = jobId ? await downloadFresh(`${base}/${jobId}`, "manifest.json") : await downloadFresh(base, "latest.json");
    manifest = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  if (!manifest) return null;
  const rels = Array.isArray(manifest.files) ? manifest.files : [];
  const created = Array.isArray(manifest.created) ? manifest.created : [];
  if (!rels.length && !created.length) return null;
  const files = {};
  for (const rel of rels) files[rel] = await downloadFresh(`${base}/${manifest.job_id}`, rel);
  return { manifest, files, created };
}

// ---------------------------------------------------------------------------
// Planner transport — the ladder
// ---------------------------------------------------------------------------
// claude-sonnet-5 -> claude-sonnet-4-5 -> gemini-2.5-flash. The best brain that
// actually answers plans the edit, and EVERY fall between rungs is recorded as
// a ghost_agency_planner_fallback event — the silent-fallback era (production's
// dead key quietly routing every customer edit to the cheapest model for days)
// is what that event exists to end.
//
// WHY sonnet-5 IS THE PRIMARY, measured 2026-08-11 on three REAL recorded
// instructions from ghost_agency_edit_jobs (a logo resize that had failed live,
// a section add, a headline colour change), same prompt contract as production:
//   - plan correctness: sonnet-5 and opus-5 both produced validator-clean plans
//     on all three (height not transform:scale on the logo, copy_block for the
//     section, h1 not section#top for the headline). No quality gap for opus to
//     close on these verbs.
//   - latency: statistically the same band (sonnet-5 1.8-2.3s, opus-5 1.3-1.9s
//     via the same transport; the plan is ~100-750 output tokens, far too small
//     for the model tier to dominate the wall clock).
//   An edit is latency-sensitive — a caller is on the phone — so the cheaper
//   model that planned every verb correctly is the right default, and opus-5
//   stays out of the ladder until a verb is measured failing on sonnet-5.
//
// NOTE the production key path was 401 ("API key is invalid") on the day this
// ladder was built — the measurement above ran the same weights over OpenRouter.
// Until ANTHROPIC_API_KEY is rotated, every edit falls (audibly, twice) to
// gemini, exactly as the events table has been showing since 2026-08-07.
const PLANNER_PRIMARY = "claude-sonnet-5";
const PLANNER_ANTHROPIC_LADDER = Object.freeze([PLANNER_PRIMARY, "claude-sonnet-4-5"]);
const PLANNER_LAST_RESORT = "gemini-2.5-flash";

/** Set when any planner rung was skipped; read by callers for reporting. */
let plannerFallbackReason = "";
function lastPlannerFallback() { return plannerFallbackReason; }

/** Every fall says so where an operator actually looks: the events table. */
function recordPlannerFall(from, to, reason) {
  plannerFallbackReason = reason;
  try {
    require("./store").recordEvent("ghost_agency_planner_fallback", { from, to, reason });
  } catch { /* telemetry must never break an edit */ }
}

function anthropicPlannerBody(model, prompt) {
  const body = { model, max_tokens: 3000, messages: [{ role: "user", content: prompt }] };
  if (model === PLANNER_PRIMARY) {
    // Sonnet 5 REJECTS non-default sampling params — the temperature:0 the old
    // rung used for determinism is a 400 here — and it thinks by default, with
    // thinking tokens billed against max_tokens, so a long think can truncate
    // the JSON plan mid-brace (a truncated plan is rejected by parsePlan, but
    // rejected is still a failed edit). The plan contract already does the
    // reasoning; thinking stays off so the whole budget is the plan and the
    // caller's wait stays flat. Measured 2026-08-11: identical plan quality
    // with and without thinking on the three recorded verbs.
    body.thinking = { type: "disabled" };
  } else {
    // temperature 0 on the pre-5 rung: the same request from the same caller
    // must not plan on one call and refuse on the next. "Update the main hero
    // image to a more colorful one" did exactly that — planned locally, refused
    // in production — and a customer cannot tell a policy from a coin flip.
    body.temperature = 0;
  }
  return body;
}

async function callPlanner(prompt, { fetchImpl = fetch } = {}) {
  plannerFallbackReason = "";
  const anthropicKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!anthropicKey) {
    recordPlannerFall(PLANNER_PRIMARY, PLANNER_LAST_RESORT, "anthropic_key_unset");
  } else {
    for (let i = 0; i < PLANNER_ANTHROPIC_LADDER.length; i += 1) {
      const model = PLANNER_ANTHROPIC_LADDER[i];
      const next = PLANNER_ANTHROPIC_LADDER[i + 1] || PLANNER_LAST_RESORT;
      let reason;
      try {
        const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify(anthropicPlannerBody(model, prompt)),
        });
        const json = await res.json();
        if (res.ok) return (json.content || []).map((c) => c.text || "").join("");
        if (json?.error?.type === "authentication_error") {
          // A DEAD KEY MUST NOT LOOK LIKE NORMAL OPERATION.
          //
          // Falling through on an auth error is deliberate — a customer on the
          // phone should get their edit, not an outage. But it was SILENT once,
          // and production's ANTHROPIC_API_KEY spent days returning 401 while
          // every customer edit was planned by the fallback model with nobody
          // knowing. The SAME key backs every Anthropic rung, so a 401 here is
          // a 401 on all of them — go straight to the last resort instead of
          // buying a second 401, and say so in the events table.
          recordPlannerFall(model, PLANNER_LAST_RESORT, "anthropic_auth_failed");
          break;
        }
        reason = `anthropic_error:${String(json?.error?.type || res.status).slice(0, 60)}`;
      } catch (error) {
        // Transport death (DNS, reset, non-JSON body) is a rung failure like
        // any other: fall, on the record, rather than costing the caller the
        // edit. The old shape threw here and the job died with it.
        reason = `anthropic_unreachable:${String((error && error.message) || error).slice(0, 80)}`;
      }
      recordPlannerFall(model, next, reason);
    }
  }
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) throw new Error("no planner model configured (ANTHROPIC_API_KEY / GEMINI_API_KEY)");
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 3000, temperature: 0.2, responseMimeType: "application/json" },
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`gemini: ${JSON.stringify(json).slice(0, 200)}`);
  return ((json.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

// ---------------------------------------------------------------------------
// The capability
// ---------------------------------------------------------------------------
/**
 * runSiteChange({ siteSlug, instruction, projectName, aliasHost, jobId })
 *
 * -> { applied: true,  changedFiles, undo, say, ... }
 *    { applied: false, refused: true, reason, say }   (truth law / impossible)
 *
 * Never throws for a refusal — a refusal is a normal outcome Riley speaks.
 * Throws only when the machinery itself failed, so a broken run can never be
 * reported to a caller as a completed change.
 */
async function runSiteChange({
  siteSlug,
  instruction,
  projectName,
  aliasHost,
  jobId,
  planner = callPlanner,
  now = new Date(),
  fetchImage = fetch,
  // The hero-video store door (set_hero_video). Injectable so a test can hand
  // the verb a fixture store and clip bytes; every production caller passes
  // nothing and gets the provenance-gated default above. `resolveHeroVideoDeps`
  // rides through to the default resolver ({ select, fetchImpl, maxBytes }).
  resolveHeroVideo = defaultResolveHeroVideoClip,
  resolveHeroVideoDeps = {},
  // Injectable so a test can hand back a measurement without a browser. Every
  // production caller passes nothing and gets the real chromium read.
  verifyEditLive = defaultVerifyEditLive,
  // The site's write-marker reader (see STALE-BASE GUARD above). Injectable for
  // the same reason verifyEditLive is: the guard's DECISION is tested against a
  // marker source that moves mid-run, without standing a storage service up.
  readSiteMarker = defaultReadSiteWriteMarker,
  // The progress meter's write side; injectable for tests. When the caller ran
  // this without a queued job row, the tracker detects that on its first stamp
  // and keeps the trail local to the returned result.
  progress = null,
}) {
  const startedAt = Date.now();
  const id = String(jobId || `edit_${Date.now()}`);
  const track = progress || createStageTracker({ jobId: id, siteSlug, instruction });
  // Phase 1 — pull the client's own archive down. Everything below reads it.
  // The write marker is read BEFORE the first archive byte: "the marker did not
  // move" at upload time then proves no writer touched the site at any point
  // during the read-plan-apply window, which is precisely the claim the
  // guard needs to make before publishing.
  await track.stamp("reading_site");
  const baseMarker = await readSiteMarker(siteSlug);
  const rels = await listAll(siteSlug);
  if (!rels.length) throw new Error(`no archived source for site '${siteSlug}'`);

  const files = {};
  const fileTexts = {};
  for (const rel of rels) {
    // Cache-busted: a plain read here returns edge-cached bytes and silently
    // reverts the previous edit. See downloadFresh().
    const buf = await downloadFresh(siteSlug, rel);
    files[rel] = buf;
    if (TEXT_EXT.test(rel) && !rel.startsWith("assets/") && buf.length < 400_000) {
      fileTexts[rel] = buf.toString("utf8");
    }
  }
  const allowedFiles = new Set(Object.keys(fileTexts));

  const facts = parseSiteFacts({ llms: fileTexts["llms.txt"] || "", index: fileTexts["index.html"] || "" });
  const ratingLine = (fileTexts["llms.txt"] || "").match(/^-\s*Rating:\s*(.+)$/im);
  facts.rating = ratingLine ? ratingLine[1].trim() : "";
  const emailLine = (fileTexts["llms.txt"] || "").match(/^-\s*Email:\s*(.+)$/im);
  facts.email = emailLine ? emailLine[1].trim() : "";
  const evidence = buildArchiveEvidence(fileTexts);
  const anchors = buildAnchorCatalog(fileTexts);
  const anchorById = new Map(anchors.map((a) => [a.id, a]));

  // An explicit "put it back" never reaches a model.
  if (/\b(undo|revert|put it back|change it back|roll ?back)\b/i.test(instruction)) {
    track.lane("undo");
    await track.stamp("applying");
    return applyUndo({ siteSlug, projectName, aliasHost, files, id, progress: track });
  }

  // A SECTION MOVE never reaches a model either. "Move the reviews above the
  // gallery" is a byte move on a static donor, and handing it to the planner
  // is how it used to die: the model has no verb shaped like it, so it either
  // refused or emitted a style_override that changed nothing a customer could
  // see. The parse is deterministic, the section is found by its heading, and
  // every failure on the way (compiled donor, unknown name, a tie) returns a
  // sentence Riley speaks — see lib/section-reorder.js.
  //
  // The op is synthesized HERE and applied by the normal loop below, so the
  // whole existing pipeline carries it: snapshot, byte-change invariant,
  // upload, deploy, rendered read-back, rollback on a proven miss, the edit
  // log and the rebuild replay.
  const reorderParsed = parseSectionReorder(instruction);

  // A GRID request ("pages for every town we serve") is not a single page
  // handed to the LLM planner either — it routes to the deterministic bounded
  // builder in lib/seo-grid.js. The check runs BEFORE the single-page one,
  // because the two classifiers are disjoint by construction (a grid request
  // is a PLURAL page request with a scope) and because a grid instruction
  // classifies as "seo-grid" on the job row, not "generic".
  const gridRequest = classifySeoGridRequest(instruction);
  if (gridRequest.grid) {
    // Same coarse trail as the seo-page lane: the grid deploys and verifies
    // through its own path.
    track.lane("seo-grid");
    await track.stamp("applying");
    const result = await runSeoGridEdit({
      siteSlug,
      projectName,
      aliasHost,
      now,
      ...(gridRequest.cap ? { cap: gridRequest.cap } : {}),
    });
    if (!result.verified || result.verified.ok !== false) await track.stamp("live");
    const n = result.built.length;
    return {
      applied: true,
      via: "seo-grid",
      kind: "seo-grid",
      changedFiles: result.changedFiles,
      built: result.built.map((b) => b.route),
      skippedCount: result.skipped.length,
      remainingCount: result.remaining.length,
      cap: result.cap,
      alias: result.alias,
      verified: result.verified,
      progress: track.summary(),
      say: n
        ? `Done — ${n} new service-area ${n === 1 ? "page is" : "pages are"} live, linked from your menu and listed in your sitemap.`
        + (result.remaining.length ? ` The next batch of ${result.remaining.length} can be built whenever you want it.` : "")
        : "Those pages are already on your site, so there was nothing new to build.",
    };
  }

  // A page request goes to the deterministic builder that already exists and
  // is already gated. This module does not re-implement it.
  if (classifyEditKind(instruction) === "seo-page") {
    // Coarse on purpose: the page builder deploys and verifies through its own
    // path, so this lane records the phases THIS module can vouch for and no
    // finer. A short honest trail beats a detailed invented one.
    track.lane("seo-page");
    await track.stamp("applying");
    const result = await runSeoPageEdit({ siteSlug, instruction, projectName, aliasHost, now });
    if (!result.verified || result.verified.ok !== false) await track.stamp("live");
    return {
      applied: true,
      via: "seo-page",
      changedFiles: result.changedFiles,
      route: result.route,
      alias: result.alias,
      verified: result.verified,
      progress: track.summary(),
      say: `That's live — there's a new ${result.topic} page on your site now, linked from the menu.`,
    };
  }

  // The compiled bundle. Read for the catalogs — which is how the planner sees
  // the elements and the words a customer sees — and writable by exactly two
  // ops, each of which edits the inside of a literal rather than any code.
  // Bounded so a huge asset cannot blow the request up.
  const assetTexts = {};
  for (const [rel, buf] of Object.entries(files)) {
    if (!BUNDLE_EXT.test(rel) || buf.length > 3_000_000) continue;
    assetTexts[rel] = buf.toString("utf8");
  }
  // Phase 2 — the catalogs and the model call: working out WHAT to change.
  await track.stamp("planning");
  const bundleScope = new Set(Object.keys(assetTexts));
  const scanText = Object.values(assetTexts).join("\n");
  const elements = buildElementCatalog(fileTexts, scanText);
  const assets = buildAssetCatalog(files, scanText);
  const copy = buildCopyCatalog(assetTexts);
  const prompt = `${PLAN_CONTRACT}\n\n${buildPlannerContext({ facts, rels: Object.keys(fileTexts), anchors, elements, assets, copy })}\n\nCUSTOMER REQUEST: ${instruction}`;
  let plan;
  if (reorderParsed) {
    track.lane("reorder");
    plan = {
      ops: [{ op: "reorder_section", ...reorderParsed, why: "customer asked to move a section" }],
      summary: `Move the ${reorderParsed.section} section ${
        reorderParsed.before ? `above the ${reorderParsed.before} section`
        : reorderParsed.after ? `below the ${reorderParsed.after} section`
        : `to the ${reorderParsed.edge} of the page`}`,
      refusal: null,
    };
  } else {
    plan = parsePlan(await planner(prompt));
  }
  if (plan.refusal) {
    return {
      applied: false,
      refused: true,
      reason: String(plan.refusal.reason || "declined"),
      progress: track.summary(),
      say: String(plan.refusal.say || "I don't think I can do that one from here — let me get it in front of the team."),
    };
  }

  const originals = {};
  const changedFiles = [];
  const createdFiles = [];
  const applied = [];
  // `files[rel]` still holds the bytes as downloaded until the verification
  // loop below reassigns it, so touching a file AFTER mutating its text still
  // snapshots the pre-edit original. That is what lets an op rewrite first and
  // record what it touched afterwards.
  const touch = (rel) => {
    if (!(rel in originals)) originals[rel] = Buffer.from(files[rel]);
    if (!changedFiles.includes(rel)) changedFiles.push(rel);
  };
  const create = (rel, buf) => {
    if (rels.includes(rel)) throw new Error(`refusing to create '${rel}' — the site already has that file`);
    files[rel] = buf;
    if (!createdFiles.includes(rel)) createdFiles.push(rel);
  };

  // Phase 3 — the deterministic apply: every op moves real bytes or throws.
  await track.stamp("applying");
  try {
    for (const op of plan.ops) {
      const kind = String(op.op || "").trim();
      if (kind === "style_override") {
        const rel = assertInScope("index.html", allowedFiles);
        // A LOGO KEEPS ITS SHAPE AND FITS ITS BOX. Runs BEFORE validation, so
        // the companion rules it adds are held to the same catalog membership
        // test as anything the planner wrote. See normalizeLogoSizing().
        const shaped = normalizeLogoSizing(composeOverrideCss(op, elements), elements);
        const css = shaped.css;
        // Rejects bare declarations, off-catalog selectors and outside imagery.
        // A rule that cannot match the served page never reaches the page, so
        // "applied" keeps meaning "the customer can see it".
        const checked = validateOverrideCss(css, { elements, assets });
        assertSubstantiated(cssSpokenText(css), { evidence, facts });
        touch(rel);
        fileTexts[rel] = applyStyleOverride(fileTexts[rel], { css, why: op.why, jobId: id });
        applied.push({
          op: kind,
          file: rel,
          bytes: css.length,
          selectors: checked.selectors,
          // WHAT A REBUILD NEEDS TO DO THIS AGAIN. See lib/site-edit-log.js:
          // the ops list above records that a change happened and which
          // selectors it used; `replay` records the change ITSELF. Without it a
          // rebuild composes a fresh tree from the donor and the customer's
          // edit is gone from the live site and from the archive at once.
          replay: { op: kind, file: rel, css, why: String(op.why || "customer request") },
          // Declarations added on the customer's behalf, named. Empty on every
          // rule that is not a logo resize.
          shaping: shaped.notes,
          // WHAT THIS RULE CLAIMS TO DO, in the grain the rendered page can be
          // asked about: one (selector, property, value) per declaration. The
          // post-deploy check reads these back off the live DOM.
          intents: declaredIntents(checked.rules),
          // Why we believe each selector matches something: the literal string
          // found in the bundle we are deploying.
          selectorEvidence: checked.selectors.map((sel) => {
            const el = elements.find((e) => allowedSelectorSet([e]).has(sel));
            return { selector: sel, element: el ? el.id : null, evidence: el ? el.evidence : null };
          }),
        });
      } else if (kind === "restyle_site") {
        // A WHOLE-SITE REPAINT, from the site's own palette. The tokens, their
        // formats and the ink flip are decided in buildRestyleCss() — this
        // branch only places the block, records what it claims, and lets the
        // rendered check read the computed token back off the live page. See
        // the RESTYLE_SITE section above for why :root never goes through
        // validateOverrideCss (the element catalog is deliberately closed, and
        // this verb's whitelist is the site's own declarations instead).
        const rel = assertInScope("index.html", allowedFiles);
        const cssSources = `${Object.values(fileTexts).join("\n")}\n${Object.values(assetTexts).join("\n")}`;
        const built = buildRestyleCss({ color: op.color, cssSources });
        assertSubstantiated(cssSpokenText(built.css), { evidence, facts });
        touch(rel);
        fileTexts[rel] = applyStyleOverride(fileTexts[rel], { css: built.css, why: op.why, jobId: id });
        applied.push({
          op: kind,
          file: rel,
          color: built.color,
          tokens: built.tokens,
          bytes: built.css.length,
          // Named companion decisions (the ink flip), the same discipline as a
          // logo resize's shaping notes.
          shaping: built.notes,
          // WHAT THIS BLOCK CLAIMS, in the grain the rendered page answers:
          // one (selector, custom property, value) per token. getComputedStyle
          // on :root returns exactly the string we wrote, so the post-deploy
          // check has a real vote here.
          intents: declaredIntents([{ selector: ":root", declarations: built.declarations }]),
          // REBUILDS replay it through the style_override lane, which
          // re-injects raw CSS verbatim — recording op: "restyle_site" there
          // would make site-edit-replay drop it as op_not_replayable and the
          // customer's repaint would vanish on the next rebuild.
          replay: { op: "style_override", file: rel, css: built.css, why: String(op.why || "customer request") },
        });
      } else if (kind === "insert_html") {
        const anchor = anchorById.get(String(op.anchor || "").trim());
        if (!anchor) throw new Error(`insert_html: '${op.anchor}' is not one of this site's anchors`);
        const rel = assertInScope(anchor.file, allowedFiles);
        const fragment = String(op.html || "").trim();
        if (!fragment) throw new Error("insert_html: empty html");
        if (/<script|<iframe|on[a-z]+\s*=/i.test(fragment)) throw new Error("insert_html: refuses to inject script, iframe or inline event handlers");
        assertSubstantiated(fragment, { evidence, facts });
        touch(rel);
        fileTexts[rel] = applyInsertHtml(fileTexts[rel], {
          exact: anchor.exact,
          position: op.position === "before" ? "before" : "after",
          fragment,
          jobId: id,
        });
        applied.push({
          op: kind,
          file: rel,
          anchor: anchor.id,
          anchorLabel: anchor.label,
          // The anchor ID is meaningless to a rebuild (the catalog is rebuilt
          // and renumbered every run); the exact string is the only stable
          // handle, and a rebuild that cannot find it EXACTLY once reports the
          // edit rather than placing the customer's words by guesswork.
          replay: {
            op: "insert_html",
            file: rel,
            anchorExact: anchor.exact,
            anchorLabel: anchor.label,
            position: op.position === "before" ? "before" : "after",
            fragment,
          },
        });
      } else if (kind === "replace_text") {
        const rel = assertInScope(op.file, allowedFiles);
        const find = String(op.find || "");
        const replace = String(op.replace == null ? "" : op.replace);
        if (!find) throw new Error("replace_text: empty find");
        assertSubstantiated(replace, { evidence, facts });
        touch(rel);
        fileTexts[rel] = applyReplaceText(fileTexts[rel], { find, replace });
        applied.push({
          op: kind,
          file: rel,
          chars: replace.length,
          replay: { op: kind, file: rel, find, replace },
        });
      } else if (kind === "copy_block") {
        const anchor = anchorById.get(String(op.anchor || "").trim());
        if (!anchor) throw new Error(`copy_block: '${op.anchor}' is not one of this site's anchors`);
        const rel = assertInScope(anchor.file, allowedFiles);
        const fragment = renderCopyBlock({
          heading: op.heading,
          paragraphs: op.paragraphs || op.text || [],
          bullets: op.bullets || [],
          jobId: id,
        });
        assertSubstantiated(fragment, { evidence, facts });
        touch(rel);
        fileTexts[rel] = applyInsertHtml(fileTexts[rel], {
          exact: anchor.exact,
          position: op.position === "before" ? "before" : "after",
          fragment,
          jobId: id,
        });
        applied.push({
          op: kind,
          file: rel,
          anchor: anchor.id,
          anchorLabel: anchor.label,
          chars: fragment.length,
          verifyText: String(op.heading || "").trim() || null,
          // A copy_block IS an insert_html once it is rendered — the block was
          // composed here, and the composed bytes are what the customer read
          // back and approved. Replaying the RENDERED fragment rather than
          // re-rendering from the structure means a later change to
          // renderCopyBlock can never silently restyle words already on a live
          // customer site.
          replay: {
            op: "insert_html",
            file: rel,
            anchorExact: anchor.exact,
            anchorLabel: anchor.label,
            position: op.position === "before" ? "before" : "after",
            fragment,
          },
        });
      } else if (kind === "replace_copy") {
        const entry = copy.find((c) => c.id === String(op.target || "").trim());
        if (!entry) {
          throw spokenRefusal(
            `replace_copy: '${String(op.target || "").slice(0, 40)}' is not one of this site's copy ids`,
            "I couldn't work out which bit of wording you meant. Read me the line as it appears on the page and I'll change it.",
          );
        }
        const rel = assertBundleInScope(entry.file, bundleScope);
        const replacement = String(op.text == null ? op.replace || "" : op.text).trim();
        if (!replacement) throw new Error("replace_copy: empty replacement text");
        assertSubstantiated(replacement, { evidence, facts });
        assetTexts[rel] = applyCopyReplace(assetTexts[rel], { literal: entry.literal, replacement });
        touch(rel);
        // The new wording has to be READABLE ON THE PAGE afterwards, not merely
        // present in the bundle. A literal swapped inside a chunk the router
        // never reaches changes bytes and changes nothing a customer sees.
        applied.push({
          op: kind,
          file: rel,
          copyId: entry.id,
          from: entry.text,
          to: replacement,
          verifyText: replacement,
          // NO FILE NAME. The bundle is rebuilt under a new content hash every
          // time, so `rel` is worthless to a replay; the LITERAL is the
          // identity, and the replay finds whichever compiled file carries it.
          replay: { op: kind, literal: entry.literal, replacement },
        });
      } else if (kind === "tracking_tag") {
        const tag = validateTrackingTag({
          vendor: op.vendor || op.provider || "",
          id: op.id || op.container_id || op.containerId || op.tracking_id || op.measurement_id || "",
        });
        // EVERY page, not just the home page. A container installed on one of
        // three HTML documents measures a fraction of the visits and reports
        // it as the whole, which is a worse outcome than no tag at all — the
        // customer makes decisions on the number.
        const pages = Object.keys(fileTexts).filter((rel) => /\.html?$/i.test(rel)).sort();
        const installedOn = [];
        let replacedId = null;
        for (const rel of pages) {
          assertInScope(rel, allowedFiles);
          const result = installTrackingTag(fileTexts[rel], tag);
          if (!result.changed) continue;
          fileTexts[rel] = result.html;
          touch(rel);
          installedOn.push(rel);
          replacedId = replacedId || result.replacedId;
        }
        if (!installedOn.length) {
          // Not a failure — the site is already in the state the caller asked
          // for. Installing a second copy would double every counted visit.
          throw spokenRefusal(
            `tracking_tag: ${tag.spec.label} ${tag.id} is already installed on every page`,
            `That one's already on your site — ${tag.spec.label} is running on every page, so there's nothing for me to add. Putting it on twice would double-count all your visits.`,
          );
        }
        // An existing privacy page names the tags on this site. Installing one
        // without updating that page publishes a stale description of what the
        // site does with visitor data — see refreshPrivacyPage().
        const refreshed = refreshPrivacyPage({
          fileTexts,
          assetTexts,
          facts,
          today: now.toISOString().slice(0, 10),
        });
        if (refreshed) {
          const privacyRel = assertInScope(LEGAL_KINDS.privacy.rel, allowedFiles);
          fileTexts[privacyRel] = refreshed;
          touch(privacyRel);
          if (!installedOn.includes(privacyRel)) installedOn.push(privacyRel);
        }
        applied.push({
          op: kind,
          vendor: tag.key,
          vendorLabel: tag.spec.label,
          id: tag.id,
          files: installedOn,
          privacyPageRefreshed: Boolean(refreshed),
          replacedId,
          // The proof that what shipped is our template and not something a
          // planner composed: the digest of the exact bytes installed.
          snippetSha256: createHash("sha256").update(tag.spec.head(tag.id)).digest("hex").slice(0, 16),
          // Vendor + id only, never the snippet. The replay re-validates them
          // through validateTrackingTag and re-renders OUR template, so a row
          // tampered with in the store still cannot put chosen bytes inside a
          // <script> on a customer's page.
          replay: { op: kind, vendor: tag.key, id: tag.id },
        });
      } else if (kind === "swap_image") {
        const want = String(op.target || "").trim();
        const asset = assets.find((a) => a.id === want || a.path === want || a.path === `/${want.replace(/^\//, "")}`);
        if (!asset) {
          throw spokenRefusal(
            `swap_image: '${want.slice(0, 60)}' is not one of this site's pictures`,
            "I couldn't tell which picture you meant. Tell me roughly where it sits on the page and I'll find it.",
          );
        }
        if (!op.source_url && !op.url && !op.image_url) throw new Error("swap_image: no source_url supplied");
        const oldRel = assertAssetInScope(asset.path, assets);
        const fetched = await fetchImageBytes(op.source_url || op.url || op.image_url, { fetchImpl: fetchImage });
        const newRel = `assets/${assetStem(oldRel)}-wss${fetched.sha256.slice(0, 8)}.${fetched.sniff.ext}`;
        const newPath = `/${newRel}`;
        // Rewrite first, then record what moved. Every reference has to follow
        // or the page ends up pointing at a file that is no longer the picture.
        const shellHits = rewriteAssetReferences(fileTexts, asset.path, newPath);
        const bundleHits = rewriteAssetReferences(assetTexts, asset.path, newPath);
        const hits = [...shellHits, ...bundleHits];
        if (!hits.length) {
          throw new Error(`swap_image: found no reference to ${asset.path} to repoint — refusing to upload a picture nothing would show`);
        }
        for (const h of hits) touch(h.file);
        // The name is the content hash, so a file already at that path is the
        // SAME picture — the customer has sent this one before, or an earlier
        // reference to it was left behind. Re-host nothing and repoint what is
        // already there. (Identical name with different bytes would be a sha256
        // collision; it is checked rather than assumed, because "impossible"
        // and "unchecked" are how the surprising failures in this system start.)
        const alreadyHosted = Buffer.isBuffer(files[newRel]) && files[newRel].equals(fetched.buf);
        if (files[newRel] && !alreadyHosted) {
          throw new Error(`swap_image: ${newRel} already exists with different bytes — refusing to overwrite`);
        }
        if (!alreadyHosted) create(newRel, fetched.buf);
        const size = imageSize(fetched.buf, newRel);
        applied.push({
          op: kind,
          replaced: asset.path,
          with: newPath,
          from: fetched.finalUrl,
          bytes: fetched.bytes,
          sha256: fetched.sha256,
          format: fetched.sniff.type,
          width: size ? size.w : null,
          height: size ? size.h : null,
          references: hits,
          // Two halves, and a replay that does one without the other would put
          // the customer's picture in the bucket and leave the page pointing at
          // the one it replaced: restore the hosted bytes, then repoint every
          // reference in the freshly built tree.
          replay: { op: kind, from: asset.path, to: newPath, sha256: fetched.sha256 },
        });
      } else if (kind === "set_hero_video") {
        // A GENERATED HERO CLIP, ATTACHED AT EDIT TIME — the owner's "generate
        // a new Seedance video and port that into their site". The reasoning
        // and every gate live with the helpers above; this branch only
        // sequences them: ladder present -> clip resolved and RE-VERIFIED
        // from the client's own Seedance store (never a plan-supplied URL) ->
        // ladder rewritten and version-bumped -> stragglers repointed ->
        // content-addressed bytes into the tree. Everything here runs BEFORE a
        // byte is uploaded, so a refusal below is still a "nothing changed".
        const htmlRels = Object.keys(fileTexts).filter((rel) => /\.html?$/i.test(rel)).sort();
        const ladderRel = ["index.html", ...htmlRels]
          .find((rel) => fileTexts[rel] && heroLadderSources(fileTexts[rel]));
        if (!ladderRel) {
          throw spokenRefusal(
            "set_hero_video: this site ships no hero-video ladder to swap",
            "This site doesn't have a hero video slot on it — it's built with a still hero instead. I can restyle that, or pass a full video hero to our team as a rebuild.",
          );
        }
        const oldSources = heroLadderSources(fileTexts[ladderRel]);
        const oldTop = oldSources[0] || "";
        if (oldTop && !/^\/?assets\/.+\.(mp4|webm|mov|m4v)$/i.test(oldTop)) {
          throw new Error(`set_hero_video: ladder top rung '${oldTop.slice(0, 60)}' is not a video asset this verb replaces`);
        }
        const resolved = await resolveHeroVideo({
          siteSlug,
          requested: String(op.clip || op.video || op.clip_id || "").trim(),
          ...resolveHeroVideoDeps,
        });
        const newRel = `assets/hero-client-wss${resolved.sha256.slice(0, 8)}.mp4`;
        const newPath = `/${newRel}`;
        // THE LADDER FIRST — the JSON island is the page's source of truth for
        // what plays; the donor's walker reads it at load and arms rung 0 onto
        // the marked <video>. Bare paths: the donors store rungs without a
        // leading slash (the walker adds it).
        let ladderChanges = 0;
        let ladderVersion = null;
        for (const rel of htmlRels) {
          if (!heroLadderSources(fileTexts[rel])) continue;
          const swapped = applyHeroLadderSwap(fileTexts[rel], { from: oldTop, to: newRel });
          if (!swapped.changed) continue;
          fileTexts[rel] = swapped.html;
          touch(rel);
          ladderChanges += swapped.changed;
          ladderVersion = swapped.version;
        }
        // THEN EVERY OTHER REFERENCE to the rung being retired — a bundle
        // literal, a poster — with the same boundary-tested rewrite swap_image
        // uses, so nothing keeps pointing at a rung that no longer plays. The
        // ladder itself was already rewritten, so this catches only stragglers.
        const stragglers = oldTop
          ? [...rewriteAssetReferences(fileTexts, oldTop, newRel), ...rewriteAssetReferences(assetTexts, oldTop, newRel)]
          : [];
        if (!ladderChanges && !stragglers.length) {
          throw new Error(`set_hero_video: found no reference to ${oldTop || "the hero ladder"} to repoint — refusing to upload a clip nothing would play`);
        }
        for (const h of stragglers) touch(h.file);
        // Content-addressed name, so a file already at that path is the SAME
        // clip — re-host nothing. (Identical name with different bytes would
        // be a sha256 collision; it is checked rather than assumed.)
        const alreadyHosted = Buffer.isBuffer(files[newRel]) && files[newRel].equals(resolved.bytes);
        if (files[newRel] && !alreadyHosted) {
          throw new Error(`set_hero_video: ${newRel} already exists with different bytes — refusing to overwrite`);
        }
        if (!alreadyHosted) create(newRel, resolved.bytes);
        applied.push({
          op: kind,
          generator: resolved.generator,
          clipRef: resolved.clipRef || null,
          replaced: oldTop || null,
          with: newPath,
          bytes: resolved.bytes.length,
          sha256: resolved.sha256,
          ladder: { file: ladderRel, changes: ladderChanges, version: ladderVersion },
          references: stragglers,
          // WHAT THE RENDERED PAGE MUST ANSWER after the deploy: the ladder's
          // top rung reads the new clip AND a hero video element is on the
          // page. See the heroChecks lane in lib/edit-verify.js.
          heroVideos: [{ expected: newPath }],
          // Restore the clip bytes, then re-apply the SAME ladder swap on the
          // freshly recomputed ladder — the recorded op is the identity.
          replay: {
            op: kind,
            from: oldTop,
            to: newRel,
            file: ladderRel,
            sha256: resolved.sha256,
          },
        });
      } else if (kind === "legal_page") {
        const wanted = String(op.kind || op.page || op.topic || "privacy").toLowerCase();
        if (/\bterms\b|\btos\b|conditions|disclaimer|refund/.test(wanted)) {
          throw spokenRefusal(
            `legal_page refused: '${wanted.slice(0, 40)}' is a contract, not a description`,
            "A terms of service is a contract between you and whoever reads it, and I'm not going to write one of those for you — that's a decision for you and your solicitor, not something I should generate. I can put up a privacy page today, and I'll flag the terms to our team.",
          );
        }
        if (!LEGAL_KINDS[wanted] && !/privacy/.test(wanted)) {
          throw spokenRefusal(
            `legal_page refused: '${wanted.slice(0, 40)}' is not a page this system generates`,
            "That's not a page I can write from here. Let me get it in front of a person on our team.",
          );
        }
        const spec = LEGAL_KINDS.privacy;
        const missing = ["businessName", "city", "state", "phone", "origin"].filter((k) => !facts[k]);
        if (missing.length) throw new Error(`legal_page refused: site facts incomplete (${missing.join(", ")})`);
        if (rels.includes(spec.rel)) {
          throw spokenRefusal(
            `legal_page: ${spec.rel} already exists`,
            "There's already a privacy page on your site, so there's nothing for me to add there.",
          );
        }

        // Read the surfaces AFTER any tracking op earlier in this same plan,
        // so "add GTM and a privacy page" produces a page that names the tag it
        // was installed alongside rather than one that is wrong on arrival.
        const observations = observeSiteDataSurfaces({ fileTexts, assetTexts });
        const today = now.toISOString().slice(0, 10);
        let pageHtml = renderPrivacyPage({
          facts,
          observations,
          today,
          styleBlock: extractSiteStyle(fileTexts["about.html"], fileTexts["index.html"]),
          // index.html AND the compiled stylesheet — on this lane the palette
          // is only ever declared in the latter. See brandAccentBlock().
          accentBlock: brandAccentBlock([
            fileTexts["index.html"] || "",
            ...Object.entries(assetTexts).filter(([r]) => /\.css$/i.test(r)).map(([, v]) => v),
          ].join("\n")),
          route: spec.route,
        });
        // The generated page carries the same tags as the rest of the site, so
        // the measurement the customer just asked for is not silently missing
        // from one page.
        for (const t of observations.tags) {
          const known = TRACKING_VENDORS[t.key];
          if (known) pageHtml = installTrackingTag(pageHtml, { key: t.key, spec: known, id: t.id }).html;
        }
        // The SAME gate every generated page in this system passes: no
        // credential, tenure, guarantee, ranking or price language, no phone
        // number that is not the business's, and no first person.
        assertNoInventedClaims(pageHtml, facts);

        create(spec.rel, Buffer.from(pageHtml, "utf8"));

        const indexRel = assertInScope("index.html", allowedFiles);
        const links = readLegalStripLinks(fileTexts[indexRel]);
        if (!links.some((l) => l.route === spec.route)) links.push({ route: spec.route, label: spec.label });
        fileTexts[indexRel] = applyLegalStrip(fileTexts[indexRel], { links, jobId: id });
        touch(indexRel);

        const loc = `${facts.origin}${spec.route}`;
        let inSitemap = false;
        if (fileTexts["sitemap.xml"]) {
          const map = insertSitemapEntry(fileTexts["sitemap.xml"], { loc, priority: "0.3", changefreq: "yearly" });
          inSitemap = map.present;
          if (map.changed) {
            fileTexts["sitemap.xml"] = map.xml;
            touch("sitemap.xml");
          }
        }
        if (fileTexts["about.html"]) {
          const about = insertSubPageNavLink(fileTexts["about.html"], { route: spec.route, label: spec.label });
          if (about.changed) {
            fileTexts["about.html"] = about.html;
            touch("about.html");
          }
        }
        // A legal page nobody can reach is not a legal page. The home page link
        // and the sitemap entry are both required before this is called done.
        if (!fileTexts[indexRel].includes(`href="${spec.route}"`)) {
          throw new Error("legal_page refused: could not link the page from the home page");
        }
        if (!inSitemap) throw new Error("legal_page refused: could not add the page to sitemap.xml");

        applied.push({
          op: kind,
          kind: "privacy",
          route: spec.route,
          file: spec.rel,
          linkedFrom: ["index.html", ...(changedFiles.includes("about.html") ? ["about.html"] : [])],
          inSitemap,
          describes: {
            tags: observations.tags,
            googleFonts: observations.googleFonts,
            maps: observations.maps,
            form: observations.form,
          },
          // The page BYTES come back from the customer's own archive (the fresh
          // build has no idea this page exists), and the footer link plus the
          // sitemap entry are re-added — a restored page nothing links to is a
          // page the customer does not have.
          //
          // linkedFrom rides along because the replay used to hardcode
          // index.html: measured on wss-test-rimrock-plumbing-billings, the
          // privacy link survived a rebuild on the home page and disappeared
          // from About. Recording the pages the link actually went on is the
          // only way the replay can put it back where the customer had it.
          replay: {
            op: kind,
            file: spec.rel,
            route: spec.route,
            label: spec.label,
            linkedFrom: ["index.html", ...(changedFiles.includes("about.html") ? ["about.html"] : [])],
          },
        });
      } else if (kind === "seo_page") {
        // Deploys through its own path — a failure past this line may have
        // moved real bytes, so it must stay a loud failure, never a "nothing
        // changed" refusal. See the machinery note on plainApplySay.
        const result = await runSeoPageEdit({ siteSlug, instruction: `add a page about ${op.topic}`, projectName, aliasHost, now })
          .catch((error) => { error.machinery = true; throw error; });
        // KNOWN GAP, RECORDED AS ONE. runSeoPageEdit writes a page plus nav and
        // sitemap links through its own path, and this module does not hold the
        // pieces to reproduce that against a freshly composed tree. Recording an
        // `unsupported` marker is what makes a rebuild REPORT "this customer has
        // an extra page we cannot carry forward" instead of quietly dropping it
        // — which is exactly the failure this whole mechanism exists to end.
        applied.push({
          op: kind,
          route: result.route,
          replay: { op: "unsupported", kind: "seo_page", route: result.route, files: result.changedFiles },
        });
        changedFiles.push(...result.changedFiles.filter((f) => !changedFiles.includes(f)));
      } else if (kind === "reorder_section") {
        // Deterministic byte move over the client's own HTML shell (never the
        // compiled bundle). Every unresolvable case throws a SPOKEN refusal —
        // compiled donors get the bigger-build sentence, an unknown section
        // name gets the page's real sections read back — and because this
        // branch runs before a byte is uploaded, "nothing on your site
        // changed" is a fact when it is spoken.
        const outcome = planSectionReorder(fileTexts, {
          section: op.section,
          before: op.before || null,
          after: op.after || null,
          edge: op.edge || null,
        }, { jobId: id, biggerBuildSay: BIGGER_BUILD_SENTENCE });
        const rel = assertInScope(outcome.file, allowedFiles);
        fileTexts[rel] = outcome.html;
        touch(rel);
        applied.push({
          op: kind,
          file: rel,
          moved: outcome.moved,
          reference: outcome.reference,
          position: outcome.position,
          // Presence of the heading proves the section survived the move; the
          // ORDER check below is what proves the move itself.
          verifyText: outcome.moved,
          // WHAT A REORDER CLAIMS, in the grain a rendered page can answer:
          // one named section appears above another. The post-deploy check
          // walks the live DOM and compares document order.
          orderings: outcome.reference
            ? [{
              before: outcome.position === "before" ? outcome.moved : outcome.reference,
              after: outcome.position === "before" ? outcome.reference : outcome.moved,
            }]
            : [],
          // The heading element runs are the identity (the anchorExact
          // discipline): a rebuild re-finds them exactly, once, or reports
          // the edit rather than re-placing a section by guesswork.
          replay: {
            op: kind,
            file: rel,
            headingExact: outcome.movedExact,
            heading: outcome.moved,
            position: outcome.position,
            referenceExact: outcome.referenceExact,
            reference: outcome.reference,
          },
        });
      } else if (kind === "undo") {
        track.lane("undo");
        // Same machinery exemption as seo_page: an undo that dies mid-restore
        // may have already rewritten files, and must fail loudly.
        return await applyUndo({ siteSlug, projectName, aliasHost, files, id, progress: track })
          .catch((error) => { error.machinery = true; throw error; });
      } else {
        throw new Error(`unknown op '${kind}'`);
      }
    }
  } catch (error) {
    if (isSpokenRefusal(error)) {
      return { applied: false, refused: true, reason: error.message, progress: track.summary(), say: error.say };
    }
    if (error && error.machinery) throw error;
    // Everything else raised while applying happened BEFORE a byte was
    // uploaded: the archive, the deploy and the live site are untouched. That
    // is a refusal the caller can hear, not a stack trace to bury in a failed
    // row — see THE EXECUTOR RETURNS ITS REFUSALS above plainApplySay.
    return { applied: false, refused: true, reason: String(error && error.message || error), progress: track.summary(), say: plainApplySay(error) };
  }

  // A plan that moved nothing is refused out loud, not reported as a change.
  // Pre-upload, so "nothing on your site changed" is a fact.
  const NOOP_SAY = "That request didn't end up changing anything on your page, so I stopped rather than tell you it had. Tell me a bit more specifically what you'd like different and I'll take another run at it.";
  if (!changedFiles.length && !createdFiles.length) {
    return {
      applied: false,
      refused: true,
      reason: "plan applied but changed nothing — refusing to report a change that did not happen",
      progress: track.summary(),
      say: NOOP_SAY,
    };
  }

  // Every op must have moved bytes. An op that silently no-ops is the exact
  // failure mode of the path this replaces, so it is refused instead — with a
  // sentence, because a bare `failed` row leaves Riley nothing to say.
  // Which map owns a file's new bytes depends on what edited it: the shell
  // text files, the compiled bundle, or a brand-new file with no predecessor.
  for (const rel of changedFiles) {
    const next = rel in fileTexts ? Buffer.from(fileTexts[rel], "utf8")
      : rel in assetTexts ? Buffer.from(assetTexts[rel], "utf8")
        : files[rel];
    if (!Buffer.isBuffer(next)) {
      return { applied: false, refused: true, reason: `op on ${rel} produced no content`, progress: track.summary(), say: NOOP_SAY };
    }
    if (next.equals(originals[rel])) {
      return { applied: false, refused: true, reason: `op on ${rel} produced no byte change`, progress: track.summary(), say: NOOP_SAY };
    }
    files[rel] = next;
  }
  for (const rel of createdFiles) {
    if (!Buffer.isBuffer(files[rel]) || !files[rel].length) {
      return { applied: false, refused: true, reason: `op created '${rel}' with no content`, progress: track.summary(), say: NOOP_SAY };
    }
  }

  // =========================================================================
  // WHAT THIS PLAN CLAIMS, IN THE GRAIN A RENDERED PAGE CAN ANSWER
  // =========================================================================
  const intents = applied.flatMap((op) => (Array.isArray(op.intents) ? op.intents : []));
  const texts = applied
    .filter((op) => String(op.verifyText || "").trim().length >= 4)
    .map((op) => ({ kind: op.op, expected: String(op.verifyText).trim() }));
  // A reorder's claim is ORDER, not presence: section A must appear above
  // section B in the rendered document. See the orderings check in
  // lib/edit-verify.js.
  const orderings = applied.flatMap((op) => (Array.isArray(op.orderings) ? op.orderings : []));
  // A hero video's claim is the LADDER AND THE ELEMENT: the page's own
  // hero-video-ladder JSON must hand the new clip to a video[data-hero-video]
  // that is actually on the page. See the heroChecks lane in lib/edit-verify.js.
  const heroVideos = applied.flatMap((op) => (Array.isArray(op.heroVideos) ? op.heroVideos : []));

  // THE STALE-BASE GUARD. One fresh marker read immediately before the first
  // write: if the site's write state moved since this run read its base, the
  // bytes in memory are yesterday's site, and publishing them would silently
  // revert another job's landed edit (the measured Air Creation clobber). This
  // throws BEFORE the snapshot, before the upload, before the deploy — nothing
  // has been written anywhere — and the runner requeues the job under the
  // named reason `stale_site_base` to replan against the fresh bytes.
  assertFreshBase(baseMarker, await readSiteMarker(siteSlug));

  // Phase 4 — snapshot the pre-edit bytes, then push the new ones into the
  // archive and read them back.
  await track.stamp("uploading");
  const undo = await snapshot({
    siteSlug,
    jobId: id,
    originals,
    created: createdFiles,
    // The revision this run publishes, for the NEXT edit's guard: the base
    // marker's counter, incremented. Serialized per site by the runner's lease.
    rev: (Number.isFinite(baseMarker && baseMarker.rev) ? baseMarker.rev : 0) + 1,
  });
  for (const rel of [...changedFiles, ...createdFiles]) {
    await upload(siteSlug, rel, files[rel], contentTypeFor(rel));
  }
  // Prove the archive took what we sent BEFORE anything is deployed or spoken.
  for (const rel of [...changedFiles, ...createdFiles]) {
    await assertArchiveMatches(siteSlug, rel, files[rel]);
  }

  // START THE BROWSER AND THE DEPLOY TOGETHER. They are the two slow steps left
  // and neither needs the other: a lambda's first chromium costs a ~150MB
  // extraction out of @sparticuz (lib/serverless-chromium), which is the same
  // order of magnitude as waiting for a Vercel deployment to go READY. Run in
  // series they overflowed the job's own 240s ceiling — measured, job
  // edit_1786238532612_igujov timed out with the change already deployed and
  // therefore unverified. Run together they cost roughly the longer of the two.
  const warmBrowser = (intents.length || texts.length || orderings.length || heroVideos.length)
    ? Promise.resolve()
      .then(() => require("./serverless-chromium").launchChromium())
      // Never reject: a launch failure has to arrive at the verifier as an
      // honest "could not look", not as an unhandled rejection racing a deploy.
      .catch((error) => ({ __error: error }))
    : null;

  // Phase 5 — the deploy. This is the stamp Riley quotes mid-call: "it is
  // deploying now" is true exactly from this moment.
  await track.stamp("deploying");
  let deployed;
  try {
    deployed = await vercelDeploy({ files, projectName, aliasHost });
  } catch (error) {
    // A browser nobody is going to use must not hold its permit until the
    // instance dies.
    if (warmBrowser) await warmBrowser.then((b) => (b && b.close ? b.close() : null)).catch(() => {});
    throw error;
  }
  const deployedAt = Date.now();

  // =========================================================================
  // READ IT BACK OFF THE LIVE PAGE. NOTHING ABOVE THIS LINE IS PROOF.
  // =========================================================================
  // Everything so far establishes that we changed the right bytes, stored them,
  // and shipped them: a valid plan, an in-catalog selector, a real byte
  // difference, an archive that matches, a deploy that went READY. Job
  // edit_1786235976776_etudr8 satisfied every one of those and the customer's
  // headline was still white, because none of them is the question the customer
  // is asking. That question — "can I see it?" — is only answerable by opening
  // the page, and so that is what happens here.
  //
  // The ALIAS is what the customer types, so the alias is what gets checked. A
  // target with no alias (site-edit-targets can resolve one) still has the
  // deployment URL serving these exact bytes — better than not looking at all.
  const origin = deployed.alias
    || (aliasHost ? `https://${String(aliasHost).replace(/^https?:\/\//, "")}` : "")
    || deployed.url
    || "";
  // The marker only exists in a page we actually rewrote. On a bundle-only edit
  // there is nothing to look for, and demanding it would turn every copy change
  // into a false "the edge is stale".
  const markerExpected = changedFiles.some((rel) => /\.html?$/i.test(rel)) ? MARK_OPEN(id) : null;
  // A CEILING OF ITS OWN. The check must never be the reason a job dies without
  // an ending — a verifier that overruns is exactly as unhelpful as no verifier,
  // and "we could not confirm it" is an answer this system knows how to give.
  // Phase 6 — reading the change back off the rendered page.
  await track.stamp("verifying");
  const measurement = await Promise.race([
    verifyEditLive({
      origin,
      intents,
      texts,
      orderings,
      heroVideos,
      marker: markerExpected,
      browser: warmBrowser,
      routes: Object.keys(fileTexts)
        .filter((rel) => /\.html?$/i.test(rel) && rel !== "index.html")
        .map((rel) => `/${rel.replace(/\.html?$/i, "")}`),
    }),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "verification_timed_out" }), VERIFY_DEADLINE_MS)),
  ]);
  const verdict = summarizeVerification(measurement);
  const verified = {
    ok: verdict.ok,
    status: verdict.status,
    reason: verdict.reason || null,
    detail: verdict.detail || null,
    checks: (measurement && measurement.checks) || [],
    textChecks: (measurement && measurement.textChecks) || [],
    heroChecks: (measurement && measurement.heroChecks) || [],
    origin,
  };

  // =========================================================================
  // THE EDIT LOG ENTRY — what makes this change survive the next rebuild
  // =========================================================================
  // lib/mirror-engine/engine.js composes a fresh tree from donor + facts +
  // content and archives it over this same bucket prefix, so before this
  // existed every rebuild erased every edit from the live site AND the archive
  // at once (measured on wss-test-rimrock-plumbing-billings: ten landed edits,
  // including a Google Analytics tag and a generated privacy page, gone after
  // one rebuild). `ops` recorded that a change happened; `replay` records the
  // change itself, in the exact shape lib/site-edit-replay.js re-applies.
  //
  // ORDER MATTERS AND IS PRESERVED: the array is in plan order, and the log
  // reads jobs oldest-first, so two edits to the same headline still compose
  // the way the customer made them.
  //
  // An op with no `replay` is one this module cannot yet reproduce. It is
  // recorded as `{op:"unsupported"}` rather than omitted, because an edit
  // missing from the log is an edit a rebuild deletes without telling anyone.
  const replay = applied.map((op) => op.replay || { op: "unsupported", kind: String(op.op || "") });

  // The trail's ending is stamped ONLY on a measured pass — a run whose change
  // could not be seen on the page never writes "live", so the history that
  // feeds the percent is built exclusively from runs that truly finished.
  if (verdict.ok) await track.stamp("live");

  const base = {
    applied: true,
    via: "plan",
    jobId: id,
    summary: plan.summary,
    // The full stamped trail rides the result so the terminal row keeps it:
    // this is the recorded history lib/edit-progress.js measures p50 stage
    // shares from. Without it every finished job would forget where its time
    // went the moment the runner wrote the outcome.
    progress: track.summary(),
    ops: applied,
    replay,
    changedFiles,
    createdFiles,
    marker: MARK_OPEN(id),
    undo: { job_id: undo.job_id, files: undo.files, created: undo.created },
    deployUrl: deployed.url,
    alias: deployed.alias,
    verified,
    // WHERE THE TIME WENT, on the record. The 240s ceiling was hit once with no
    // way to tell which phase ate it; a number in the job row is how the next
    // one gets answered in seconds instead of by re-running production.
    timings: {
      total_s: +((Date.now() - startedAt) / 1000).toFixed(1),
      to_deploy_s: +((deployedAt - startedAt) / 1000).toFixed(1),
      verify_s: +((Date.now() - deployedAt) / 1000).toFixed(1),
    },
  };

  if (verdict.ok) return { ...base, say: spokenResult(plan.summary) };

  // NOT LANDED: the change is provably invisible. Leaving it there would leave a
  // customer's live site carrying an edit that did not do what they asked and
  // may have done something else — so it goes back, using the snapshot this run
  // has already written, and the rollback is the thing that makes "nothing on
  // your site changed" a true sentence rather than a hopeful one.
  //
  // UNCONFIRMED is different and is deliberately NOT rolled back: not being able
  // to look at the page is not evidence that the edit is wrong, and undoing a
  // customer's change on a suspicion would be its own kind of damage. It is
  // simply never reported as done.
  let reverted = null;
  if (verdict.status === "not_landed") {
    try {
      const back = await applyUndo({ siteSlug, projectName, aliasHost, files, id: `${id}-revert` });
      reverted = back && back.applied === true;
    } catch {
      reverted = false;
    }
  }
  return {
    ...base,
    reverted,
    say: sayForVerdict(verdict, { reverted }),
  };
}

/**
 * The archive is content-addressed by path, and the deploy reads it back, so a
 * picture stored as application/octet-stream would be re-served as one. Every
 * type this module can write is named here rather than defaulted.
 */
function contentTypeFor(rel) {
  const ext = String(rel).split(".").pop().toLowerCase();
  return {
    html: "text/html", htm: "text/html", xml: "application/xml", json: "application/json",
    css: "text/css", js: "application/javascript", txt: "text/plain", svg: "image/svg+xml",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    // Hero clips ride this lane now (set_hero_video): a clip archived as
    // application/octet-stream would be re-served as one.
    mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  }[ext];
}

async function applyUndo({ siteSlug, projectName, aliasHost, files, id, progress = null }) {
  // The rollback-after-a-failed-verify call passes no tracker on purpose: a
  // meter that jumped BACK to "uploading" while a customer watched would read
  // as the bar reversing. Only a customer-asked undo narrates its phases.
  const track = progress || nullTracker();
  const restored = await loadUndo({ siteSlug });
  if (!restored) {
    return {
      applied: false,
      refused: true,
      reason: "no snapshot to restore",
      progress: track.summary(),
      say: "I don't have a previous version saved for your site, so there's nothing for me to roll back to. Tell me what looks wrong and I'll fix it forward instead.",
    };
  }
  await track.stamp("uploading");
  const changedFiles = [];
  for (const rel of restored.manifest.files || []) {
    files[rel] = restored.files[rel];
    changedFiles.push(rel);
    await upload(siteSlug, rel, files[rel], rel.endsWith(".html") ? "text/html" : undefined);
  }
  // Files the change CREATED are removed from both the archive and the deploy
  // manifest. Dropping the key alone is not enough: listAll() rebuilds the
  // deploy set from the archive on the next edit, so a page left behind there
  // would walk back onto the live site later.
  const removedFiles = [];
  for (const rel of restored.created || []) {
    delete files[rel];
    await removeArchivedObject(siteSlug, rel);
    removedFiles.push(rel);
  }
  await track.stamp("deploying");
  const deployed = await vercelDeploy({ files, projectName, aliasHost });

  // "I'VE PUT YOUR SITE BACK" IS A CLAIM TOO. It is the same shape as the one
  // this module was cleaned of — a deploy reported as a result — so it is
  // checked the same way, on the served page. No browser is needed: every edit
  // this system writes into a page leaves <!-- wss-edit <jobId> --> in the HTML,
  // so "is the change gone" is a fetch and a substring test. Only meaningful
  // when the change touched an HTML file; a bundle-only edit leaves no marker
  // and gets an honest null rather than an invented pass.
  const restoredHtml = (restored.manifest.files || []).some((rel) => /\.html?$/i.test(rel));
  const origin = deployed.alias
    || (aliasHost ? `https://${String(aliasHost).replace(/^https?:\/\//, "")}` : "")
    || deployed.url
    || "";
  await track.stamp("verifying");
  let gone = null;
  if (restoredHtml && origin && restored.manifest.job_id) {
    const marker = MARK_OPEN(restored.manifest.job_id);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetch(`${origin.replace(/\/+$/, "")}/?wss-undo=${Date.now()}`);
        const html = res.ok ? await res.text() : "";
        if (res.ok) {
          gone = !html.includes(marker);
          if (gone) break;
        }
      } catch { /* an unreadable page leaves `gone` as it was */ }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 4000));
    }
  }

  if (gone !== false) await track.stamp("live");
  return {
    applied: true,
    via: "undo",
    jobId: id,
    restoredFrom: restored.manifest.job_id,
    changedFiles,
    removedFiles,
    deployUrl: deployed.url,
    alias: deployed.alias,
    verified: gone === null ? null : { ok: gone, status: gone ? "landed" : "not_landed", reason: gone ? null : "previous_change_still_on_the_page", origin },
    progress: track.summary(),
    say: gone === false
      ? "I tried to put your site back and the old version is still showing on the page, so I'm not going to tell you it's done. Someone on our team is on it now."
      : "Done — I've put your site back the way it was before that change.",
  };
}

/** Read the change back off the LIVE host. A deploy id is not a rendered page. */
async function verifyMarkerLive({ origin, marker, attempts = 12, waitMs = 5000, fetchImpl = fetch, sleep }) {
  const rest = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchImpl(`${String(origin).replace(/\/+$/, "")}/?wss=${Date.now()}`);
      const html = res.ok ? await res.text() : "";
      last = { status: res.status, present: html.includes(marker), bytes: html.length };
      if (last.status === 200 && last.present) return { ok: true, ...last, attempts: i + 1 };
    } catch (error) {
      last = { error: String(error.message || error) };
    }
    if (i < attempts - 1) await rest(waitMs);
  }
  return { ok: false, ...(last || {}), attempts };
}

module.exports = {
  runSiteChange,
  buildElementCatalog,
  buildAssetCatalog,
  buildPlannerContext,
  verifyMarkerLive,
  // exported for tests
  validateOverrideCss,
  lastPlannerFallback,
  composeOverrideCss,
  normalizeLogoSizing,
  parseDeclarations,
  parseCssRules,
  allowedSelectorSet,
  splitTopLevel,
  imageSize,
  assetLabel,
  buildAnchorCatalog,
  buildArchiveEvidence,
  assertSubstantiated,
  cssSpokenText,
  assertInScope,
  applyStyleOverride,
  applyInsertHtml,
  applyReplaceText,
  spokenResult,
  parsePlan,
  visibleText,
  __planner: callPlanner,
  plainApplySay,
  PLANNER_PRIMARY,
  PLANNER_ANTHROPIC_LADDER,
  PLANNER_LAST_RESORT,
  PLAN_CONTRACT,
  PLAN_MAX_OPS,
  UNDO_PREFIX,
  CLAIM_RULES,
  // The cache-busted archive read. lib/mirror-engine/engine.js needs it for the
  // same reason runSiteChange does: a plain read of Supabase Storage returns
  // edge-cached bytes, and a rebuild restoring a customer's page from a stale
  // copy would put back a version they had already changed.
  downloadFresh,
  // --- the ops added for the real support queue --------------------------
  // tracking
  TRACKING_VENDORS,
  validateTrackingTag,
  assertTemplateOriginsAllowed,
  installTrackingTag,
  readInstalledTags,
  insertTagInHead,
  insertTagInBody,
  vendorKey,
  // images
  sniffImage,
  assertFetchableImageUrl,
  fetchImageBytes,
  rewriteAssetReferences,
  assetStem,
  assertAssetInScope,
  contentTypeFor,
  // copy
  buildCopyCatalog,
  applyCopyReplace,
  assertBundleInScope,
  renderCopyBlock,
  // legal
  LEGAL_KINDS,
  observeSiteDataSurfaces,
  renderPrivacyPage,
  refreshPrivacyPage,
  printableTagId,
  applyLegalStrip,
  readLegalStripLinks,
  // The sub-page nav link. Exported because lib/site-edit-replay.js has to put
  // it back on the SAME pages the original edit put it on — a privacy link
  // that survives on the home page and vanishes from About is a rebuild
  // quietly editing the customer's site.
  insertSubPageNavLink,
  brandAccentBlock,
  extractSiteStyle,
  // The section move (reorder_section). Re-exported so callers and tests have
  // one door to the executor's full verb surface; the implementation and its
  // reasoning live in lib/section-reorder.js.
  parseSectionReorder,
  planSectionReorder,
  buildSectionCatalog,
  applySectionReorder,
  // The whole-site recolour (restyle_site).
  RESTYLE_NAMED_COLORS,
  RESTYLE_PALETTE_TOKENS,
  RESTYLE_INK_TOKENS,
  normalizeRestyleColor,
  relativeLuminance,
  detectRestyleTokens,
  buildRestyleCss,
  // The stale-base guard (see STALE-BASE GUARD above). Exported so the
  // decision — and the sentence it refuses with — can be held by tests and
  // reused if a second full-site publisher ever appears.
  readManifestMarker,
  defaultReadSiteWriteMarker,
  siteMarkerIdentity,
  assertFreshBase,
  // The hero video (set_hero_video): the ONE apply function for a ladder swap
  // (lib/site-edit-replay.js replays through it), the ladder readers, the
  // provenance gates, and the provenance-gated store resolver.
  parseHeroLadders,
  heroLadderSources,
  applyHeroLadderSwap,
  seedanceProvenanceFault,
  defaultResolveHeroVideoClip,
  MAX_HERO_CLIP_BYTES,
};