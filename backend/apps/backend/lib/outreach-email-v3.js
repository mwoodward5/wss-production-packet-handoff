"use strict";
// lib/outreach-email-v3.js — the proof email, rebuilt ON THE WSS BRAND KIT.
//
// THE OWNER'S BRIEF (2026-08-07): chosen out of hundreds, no founder anywhere,
// see the site before paying, Riley front and centre, before/after visual, a
// real deadline — "the email is visually like, damn, these guys are pros."
//
// THE COMPRESSION PASS (2026-08-12, owner walkthrough). His verdict on the
// long form: too busy, too flat, "everything is too similar colored and not
// popping", the report card "not graphical enough, gets lost", how-to-get-in
// "too directive — step one step two step three, these people aren't bright",
// and the whole thing should collapse "into one fifth of the space, still the
// same comprehension." Plus two stories the canon already held
// (docs/sales/brand-positioning.md) that the email never told: "your site was
// selected" and "we are providing American AI to businesses."
//
// HIS ORDER, NOW THE ORDER OF THE FILE'S OUTPUT:
//   1. the comparison at the top — theirs vs ours, PHONE PAIR PROMINENT;
//   2. what you GET, graphically dense — the site, the $1,000 report with a
//      road map, Riley, the app — with the report card as a GRAPHIC (grade
//      tile big, bars for the holding-back items, not a numbered list);
//   3. the selected / American-AI story in two sentences;
//   4. the price with the waived items struck through;
//   5. three PICTURES for how to get in — numbered thumbnails (your site /
//      your dashboard / call Riley), not paragraphs.
//
// TWO COLOUR SYSTEMS, ON PURPOSE: the client's own measured accent
// (`brandColor`, via design.clientAccent — hue theirs, lightness only ever
// moved to clear WCAG) marks what is THEIRS — the name chip, the frame around
// their new site. WSS blue marks what is OURS — the buttons, the tiles, the
// price. Everything else stays neutral so the two colours actually pop.
//
// FIRST DRAFT WAS OFF-BRAND AND HE CAUGHT IT IN ONE LOOK. I invented a
// yellow-and-black palette while lib/wss-email-design.js — the actual brand
// system — sat one require away. Every colour and type role below comes from
// that module; nothing is invented here.
//
// DELIBERATE OMISSIONS: no founder photo/letter/signature; no ticking
// countdown (email cannot tick — a real date is honest urgency).
//
// THE NO-PHONE RULE WAS FOR SALES PRESSURE, NOT FOR RILEY (2026-08-07). Riley's
// free-call line is an offer to prove the product live, on the prospect's own
// terms, before they have paid anything — so it EARNS the number being shown.
// The block still disappears whenever no number is supplied.
//
// TRUTH LAW APPLIES TO MARKETING: the rating renders only WITH its review
// count; an absent field removes its block, never prints a placeholder; the
// selection sentence describes what the miner actually does; the expiry is
// computed from a real timestamp. COMPRESSION LOOSENED NO GATE: every field
// below keeps the exact absent-removes-the-block rule it had in the long form.
//
// EMAIL CLIENTS ARE NOT BROWSERS: table layout, inline styles, no JS, no
// webfont <link> (the stack falls back cleanly), images only over https, and
// every critical style inline — the ONE <style> block (see the head) carries
// only the primary CTAs' light-sweep animation, so a client that strips it
// loses motion, never rendering.

const design = require("./wss-email-design");
const { gradeBadgeColor } = require("./email");

// The report grades on this scale, so the email speaks it too. Also doubles
// as the whitelist that rejects a junk grade instead of printing it.
const GRADE_LADDER = ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];

// WHAT THE WAIVED $500 BUYS — A LIST OF WORK THIS CODEBASE PERFORMS.
//
// This line read "content extraction, remastering, content creation & local
// market research" until 2026-08-08. "Remastering" was the one word in it with
// no code behind it, and it was also the most concrete-sounding: a business
// owner reads it as "they are going to clean up my photographs."
//
// MEASURED, NOT ASSUMED. Nothing in this repository touches a client pixel.
// lib/mirror-engine/client-photos.js harvests candidate images, proves the
// bytes belong to the prospect, sniffs and size-floors them, refuses stock and
// third-party marks, dedupes by content hash and responsive variant, and RANKS
// what survives — then keeps `url: secureUrl`, the client's own URL, verbatim.
// The single byte-level operation on a client photograph anywhere in the lane
// is brand-assets.transcodePhoto(), a CONTAINER conversion so a .webp file can
// fill a .jpg slot without being mislabelled; it returns its input untouched
// when the formats already match, and it shells out to an ffmpeg this codebase
// documents in five places as absent from the serverless runtime.
//
// So the choice was not "wire it or cut it" — there was nothing to wire. No
// image library is in package.json (@sparticuz/chromium, acorn, ajv,
// ajv-formats, playwright, playwright-core), no remaster module exists in any
// lane, and generating a replacement photograph of someone's business would
// violate TRUTH LAW even if one did.
//
// The replacement is stronger because every clause is checkable:
//   * "pulling your content, photos and brand off your own site" — scan +
//     capture-brand (logo, palette, typeface) + client-photos.
//   * "writing your pages" — mirror-engine/authority-pages.js ships /about,
//     /service-areas and /faq built from their verified content.
//   * "measuring your local market" — nearby-cities.js samples a ring around
//     the verified coordinates and resolves each point against the US Census
//     geocoder, and the Signal report ranks them against local competitors.
//   * "the eleven checks this build passed" — engine.js REQUIRED_CHECKS.
//     computeRevealable() demands all eleven be "passed" before a mirror is
//     revealable, and an unrevealable mirror is never emailed: by the time a
//     prospect reads this sentence, those eleven checks have already passed on
//     their own site. test/email-unbuilt-work-claims.test.js pins the number
//     to the engine's own list so the copy cannot outlive it. It was ten until
//     2026-08-11, when `sameness` joined the list — the check that refuses to
//     publish a mirror whose headline or title is another mirror's.
//
// IT LIVES OUT HERE, NOT IN THE TEMPLATE, FOR TWO REASONS. Both MIME halves
// interpolate this one string, so they cannot drift into two different
// promises. And an explanation this long written as an HTML comment inside the
// template literal would be SHIPPED TO THE PROSPECT — email comments travel
// with the message. That is not hypothetical; the first draft of this fix did
// exactly that and the test caught it.
const SETUP_FEE_COVERS = "pulling your content, photos and brand off your own site, writing your pages, measuring your local market, and the eleven checks this build passed before you were emailed.";

// Number("") and Number(null) are both 0, and Number.isFinite(0) is true, so
// the obvious guard silently turns "never measured" into "scored zero" — which
// is how a business gets told it failed something we never looked at. Anything
// that is not a real number stays null, and null is never printed.
function numOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Report-facing names for the eight scored categories. These match the labels
// the Signal report prints, so the email and the report they click through to
// never call the same measurement two different things.
// `businessIntelligence` was MISSING and the fallback below is the raw key, so
// a report carrying it (7 of 20 live reports do) would have put
// "businessIntelligence — F, 40/100" in a cold email. Every key
// lib/report-grade.js can emit must have an entry here, and
// test/report-grade.test.js asserts that.
const CATEGORY_LABEL = {
  socialMedia: "Social media",
  technology: "Site technology",
  security: "Security",
  googleBusinessProfile: "Google Business Profile",
  onlineReputation: "Reputation",
  websitePerformance: "Site speed",
  seo: "SEO",
  geo: "AI search",
  businessIntelligence: "Business intelligence",
};
// Plain names for the signals a business owner would recognise. A plumber
// knows what "no Instagram" means; nobody outside this trade knows what a
// permissions policy is, so anything that needs a glossary is summarised at
// the category level by CATEGORY_PLAIN below instead of listed raw.
const SIGNAL_LABEL = {
  twitter: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  yelp: "Yelp",
  facebook: "Facebook",
  profile_description: "a business description",
};

// One plain sentence per category whose raw signal names are engineer-speak.
// Each is a faithful summary of what the missing signals ARE — it says the
// same thing in words the reader can act on, and is only ever used when that
// category actually scored below the bar.
const CATEGORY_PLAIN = {
  security: "browser security headers most modern sites set",
  technology: "modern site tooling — yours is running on dated code",
  websitePerformance: "speed headroom on mobile",
  geo: "signals AI search engines use to trust your listing",
};

// FORMATS MEASUREMENTS, DOES NOT JUDGE THEM. Takes the qualification
// categories we actually scored and returns the three weakest as short
// sentences. Every number and every missing-signal name is read straight out
// of the scan — nothing here decides what is wrong with a business, it only
// puts our own findings into words. Categories at 90+ are not "holding you
// back" and are never listed, so a genuinely strong business yields [] and
// the whole block disappears instead of manufacturing a complaint.
function gradeReasonsFromCategories(categories, limit = 3) {
  if (!categories || typeof categories !== "object") return [];
  return Object.entries(categories)
    .map(([key, v]) => [key, v, numOrNull(v && v.score)])
    .filter(([, , score]) => score !== null && score < 90)
    .sort((a, b) => a[2] - b[2])
    .slice(0, limit)
    .map(([key, v, score]) => {
      const label = CATEGORY_LABEL[key] || key;
      const head = `${label} — ${v.grade ? `${v.grade}, ` : ""}${Math.round(score)}/100`;
      const unmet = (Array.isArray(v.signals) ? v.signals : [])
        .filter((s) => s && (s.observed === false || s.observed === 0 || s.observed === ""));
      // THE SCORE IS EVIDENCE; THE ACCUSATION BESIDE IT NEEDS ITS OWN. This
      // branch used to fire on score<90 alone, so a category the report graded
      // B/83 was still told it was "Missing browser security headers" — a
      // sentence no report data supports, printed under a card that promises
      // "in the order your report lays out". The report path deliberately
      // strips `signals`, which is exactly the case that must stay silent: a
      // number we can source, and not one word more than we can source.
      if (CATEGORY_PLAIN[key]) return unmet.length ? `${head}. Missing ${CATEGORY_PLAIN[key]}.` : `${head}.`;
      const missing = unmet
        .map((s) => SIGNAL_LABEL[s.name])
        .filter(Boolean);
      if (!missing.length) return `${head}.`;
      const shown = missing.length > 3
        ? `${missing.slice(0, 3).join(", ")} and ${missing.length - 3} more`
        : missing.join(", ").replace(/, ([^,]*)$/, " and $1");
      return `${head}. No ${shown}.`;
    });
}

// THE BARS BEHIND THE GRAPHIC (2026-08-12). The owner's exact words on the
// report card: "not graphical enough, gets lost" — so the HTML half renders
// the three holding-back items as BARS, and a bar needs a label, a letter and
// a score as DATA, not as a prose sentence to re-parse. Same source, same
// filter, same ordering and same cap as gradeReasonsFromCategories — this is
// the identical selection rendered as numbers instead of sentences, so the
// two can never disagree about WHICH categories are holding a business back.
function gradeBarsFromCategories(categories, limit = 3) {
  if (!categories || typeof categories !== "object") return [];
  return Object.entries(categories)
    .map(([key, v]) => [key, v, numOrNull(v && v.score)])
    .filter(([, , score]) => score !== null && score < 90)
    .sort((a, b) => a[2] - b[2])
    .slice(0, limit)
    .map(([key, v, score]) => ({
      label: CATEGORY_LABEL[key] || key,
      grade: typeof v.grade === "string" && GRADE_LADDER.includes(v.grade.trim().toUpperCase())
        ? v.grade.trim().toUpperCase()
        : "",
      score: Math.round(score),
    }));
}

// WHAT'S WORKING — the report leads with this, and so should we. The owner's
// note on the road map was "don't shoot the messenger, but we have a plan for
// you"; opening with their own wins is what earns the right to list the
// problems underneath. Same sourcing rule as everything else: a category
// only counts as a strength if the REPORT scored it 90+, and a business with
// nothing above 90 gets no green chips rather than a manufactured compliment.
function gradeStrengthsFromCategories(categories, limit = 3) {
  if (!categories || typeof categories !== "object") return [];
  return Object.entries(categories)
    .map(([key, v]) => [key, v, numOrNull(v && v.score)])
    .filter(([, , score]) => score !== null && score >= 90)
    .sort((a, b) => b[2] - a[2])
    .slice(0, limit)
    .map(([key, v, score]) => `${CATEGORY_LABEL[key] || key} — ${v.grade ? `${v.grade}, ` : ""}${Math.round(score)}/100`);
}

// Where we tell them we can take them. Two rungs up, floored at B+ so a D
// gets the owner's line ("we can get you to a B+"), and capped at A- so we
// never promise a perfect score. A business already at A- or better has no
// uplift to sell — that returns "" and the promise line disappears rather
// than inventing headroom that isn't there.
function targetGrade(g) {
  const i = GRADE_LADDER.indexOf(g);
  if (i < 0) return "";
  const cap = GRADE_LADDER.indexOf("A-");
  const goal = Math.max(i + 2, GRADE_LADDER.indexOf("B+"));
  return goal > cap || i >= cap ? "" : GRADE_LADDER[goal];
}
const { normalizePhone } = require("./riley-line");
// THE OPT-OUT PROMISE HAS ONE DEFINITION. This file used to end with its own
// sentence ("Reply STOP to opt out."), which is a SECOND promise: the
// plain-text half of a cold email carries OPT_OUT_PROMISE from the compliance
// footer, so the two MIME parts of one message would have told the reader two
// different things about how to make it stop. That is the exact defect
// test/opt-out-parity.test.js exists to catch, and it is why the sentence lives
// in exactly one module that every renderer imports.
const { optOutPromiseHtml } = require("./opt-out-promise");
// The approved value-stack config. It lives in lib/proof-email-inputs.js (the
// owner keeps the numbers editable there); this is a top-level require and NOT a
// cycle, because proof-email-inputs requires this composer LAZILY (composerModule)
// and never at load time — so by the time this line runs, that module's own
// top-level requires (report-url, riley-line) have already resolved.
const { VALUE_STACK } = require("./proof-email-inputs");

const { PALETTE, TYPE, FONT_STACK, WSS_MARK_URL, cardStyle, eyebrow, readableOn } = design;

// EVERY <img> IN A COLD EMAIL IS SERVED FROM A HOST WE CONTROL.
// lib/outreach-email-v2.js firstPartyImage() and
// test/email-truth-packet-adapter.test.js enforce *.wss-ai.com on every image
// source in a composed proof email. The reason is not aesthetics: a
// third-party image in cold outreach is an off-domain fetch we cannot vouch
// for, on behalf of a stranger who did not ask to be written to, and the
// allowlist is the thing that stops a donor logo or a scraped photo becoming
// an <img> the same way. This composer takes image URLs only from callers
// that minted them on our own signed media route, plus the two brand assets
// below — there is no vendor-mark or third-party icon anywhere in it.
//
// Same first-party host as the WSS mark, so Gmail treats it as brand imagery
// rather than a tracking pixel from an unknown domain.
const RILEY_AVATAR_URL = "https://ghost.wss-ai.com/brand/riley-avatar.png";
// THE AMERICAN FLAG, AS A REAL FIRST-PARTY RASTER (owner final-polish pass,
// 2026-09-03). A US flag vector was converted to a PNG/WebP pair and parked in
// the same /brand/ directory as the WSS mark and Riley's avatar. It replaces
// BOTH prior flag renderings: the 🇺🇸 emoji (which Windows Outlook desktop has
// no glyph for — it printed the letters "US") and the pure-table drawn flag
// that had been built to dodge that. A raster <img> renders identically in
// Gmail, Apple Mail and Outlook desktop, so the drawn table is retired
// outright. The .webp twin ships beside it (17KB vs 81KB) for any surface that
// wants the smaller bytes; the email itself references the PNG, because PNG is
// the one format every mail client decodes.
const US_FLAG_URL = "https://ghost.wss-ai.com/brand/us-flag.png";
// THE WSS CONNECT APP GRAPHIC IS DRAWN, NOT EMBEDDED (owner pass v2, the
// showpiece note). It used to be connect-funnel.png — six letter tiles
// funnelling into a W — which the owner read as "plain letters". Its
// replacement below is a pure-table app frame (WSS mark upper-left, real
// brand-coloured channel badges, a live inbox plate) that reuses the
// first-party W mark PNG this email already ships, so the image inventory
// count is unchanged while the funnel asset itself retires.

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const httpsOnly = (u) => (/^https:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");

/** "August 14" from a Date — the honest form of a countdown in an inbox. */
function expiryLabel(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

/**
 * composeOutreachEmailV3({...}) -> { subject, preheader, html, text }
 * Absent fields REMOVE their block. No placeholders, ever.
 */
function composeOutreachEmailV3(o = {}) {
  const ownerProof = o.ownerProof === true;
  const marketProvisional = ownerProof && o.marketProvisional === true;
  const business = String(o.businessName || "").trim();
  const city = marketProvisional ? "" : String(o.city || "").trim();
  const preview = httpsOnly(o.previewUrl);
  const report = httpsOnly(o.reportUrl);
  const beforeShot = httpsOnly(o.beforeImage);
  const afterShot = httpsOnly(o.afterImage);
  // THE PROSPECT'S OWN SITE. The only honest destination for the "Before" half.
  // Absent means the before thumbnail is not a link at all — never a link to
  // ours. See heroBlock.
  const currentSite = httpsOnly(o.currentUrl);
  const clientId = String(o.clientId || "").trim();
  const rating = String(o.rating || "").trim();
  const reviews = String(o.reviewCount || "").trim();
  const postal = String(o.postalAddress || "").trim();
  const unsub = httpsOnly(o.unsubUrl);
  // NO INVENTED DEADLINE (fixed 2026-08-07, at wire-up).
  //
  // This read `expiryLabel(o.expiresAt || Date.now() + 7 * 864e5)`. It was the
  // only field in this file that manufactured a value instead of removing its
  // block, and it contradicted the TRUTH LAW note at the top of the file: on
  // the 44 of 45 queued rows with no stored preview_expires_at it printed "We
  // keep your preview on our server until <today+7>" — a commitment to a real
  // business that nothing in the system recorded or enforces. It also could
  // not be switched off from the call site, because null, "" and 0 all fall
  // through `||` to the fabricated date.
  //
  // Now: a timestamp we were actually given, or no expiry block at all.
  const expires = o.expiresAt === undefined || o.expiresAt === null || o.expiresAt === ""
    ? ""
    : expiryLabel(o.expiresAt);
  const scanned = marketProvisional ? null : (Number(o.scannedCount) > 0 ? Number(o.scannedCount) : null);
  const setupFeeCovers = marketProvisional
    ? "pulling your content, photos and brand off your own site, writing your pages, and the eleven checks this build passed before you were emailed."
    : SETUP_FEE_COVERS;
  // THE GRADE IS QUOTED, NEVER GUESSED. It must be the same letter the
  // linked report renders (build_ready.qualification.composite_signal), or
  // the email calls them a D on a page that says B. A fallback letter here
  // would be a fabrication about a real business, so there isn't one:
  // no measured grade means the whole card is dropped.
  const grade = GRADE_LADDER.includes(String(o.grade || "").trim().toUpperCase())
    ? String(o.grade).trim().toUpperCase()
    : "";
  const gradeScore = numOrNull(o.gradeScore) === null ? null : Math.round(numOrNull(o.gradeScore));
  const goalGrade = grade ? targetGrade(grade) : "";

  // WHY THE GRADE HAS A GRADE. "It scored a B" tells nobody what to fix; the
  // caller holds the real per-category measurements and passes the short human
  // sentences here. Never computed in this file — a composer that invented its
  // own reasons from a bare letter would be guessing, and TRUTH LAW does not
  // allow that.
  const gradeReasons = Array.isArray(o.gradeReasons)
    ? o.gradeReasons.map((r) => String(r || "").trim()).filter(Boolean).slice(0, 3)
    : [];

  // THE SAME SELECTION AS DATA — see gradeBarsFromCategories. Caller-supplied
  // on the same terms as gradeReasons; malformed entries are dropped, never
  // repaired, and an empty list falls back to the prose reasons so a direct
  // caller that only has sentences still gets an honest card.
  const gradeBars = Array.isArray(o.gradeBars)
    ? o.gradeBars
      .map((b) => (b && typeof b === "object" ? {
        label: String(b.label || "").trim(),
        grade: GRADE_LADDER.includes(String(b.grade || "").trim().toUpperCase())
          ? String(b.grade).trim().toUpperCase()
          : "",
        score: numOrNull(b.score),
      } : null))
      .filter((b) => b && b.label && b.score !== null && b.score > 0 && b.score < 100)
      .slice(0, 3)
    : [];

  // Their wins, listed above their problems. Caller-supplied on the same terms
  // as gradeReasons: this file never decides what a business is good at.
  const gradeStrengths = Array.isArray(o.gradeStrengths)
    ? o.gradeStrengths.map((r) => String(r || "").trim()).filter(Boolean).slice(0, 3)
    : [];

  // ----------------------------------------------------- TRUST, REPACKAGED HIGH
  //
  // Owner, 2026-08-12: "repackage all of the trust signals back in from our
  // previous work" — punchy, in the EMAIL and not only on the mirror. Every
  // datum here is the SAME class of Google-pinned fact the site rail renders
  // (lib/verified-trust-lookup.js, pinned by place_id), and every one keeps this
  // file's one rule: absent removes its block. No rating removes the star band;
  // no quotes removes the quote card; an unheld credential removes only its pill.
  // Nothing here is inferred — a star we cannot source is a star we do not draw.
  const ratingNum = numOrNull(rating);
  const reviewsNum = numOrNull(reviews);
  // en-US grouping so 1212 reads as "1,212" — the number a business recognises
  // as its own. Only ever shown beside the word "reviews", never bare.
  const reviewsLabel = reviewsNum !== null ? reviewsNum.toLocaleString("en-US") : "";
  // Up to two reviewer quotes. THE AVATAR IS A MONOGRAM, NOT A FACE — on
  // purpose. Google serves reviewer faces from googleusercontent.com, and the
  // first-party image law this file lives under (firstPartyImage /
  // test/email-truth-packet-adapter) forbids any off-domain <img> in cold
  // outreach: a third-party image is a fetch we cannot vouch for on behalf of a
  // stranger who did not ask to be written to. So the quote card carries the
  // reviewer's INITIAL, drawn as a monogram — a real avatar style, no network,
  // no leak — and the words and the name still ship. Empty quotes drop; capped
  // at two for the compression the owner set: proof, not a wall.
  const reviewQuotes = (Array.isArray(o.reviewQuotes) ? o.reviewQuotes : [])
    .map((q) => (q && typeof q === "object" ? {
      text: String(q.text || "").trim(),
      author: String(q.author || "").trim(),
      rating: numOrNull(q.rating),
      // A REAL reviewer face, first-party only. The caller re-hosts the Google
      // photo to a *.wss-ai.com URL; anything else is dropped and the row falls
      // back to a monogram. Never a raw googleusercontent <img>.
      faceUrl: /^https:\/\/(?:[a-z0-9-]+\.)*wss-ai\.com\//i.test(String(q.faceUrl || "").trim())
        ? String(q.faceUrl).trim() : "",
    } : null))
    // `q.text` ONLY. The faceUrl above already reduces a non-first-party URL
    // to "" — the row then falls back to its monogram, which is the documented
    // behaviour ("anything else is dropped and the row falls back to a
    // monogram"). Requiring q.faceUrl here dropped every face-less quote and
    // took the whole quote card with it; pinned by email-trust-repackage.
    .filter((q) => q && q.text)
    .slice(0, 2);
  // Two credentials a business either holds or does not — NEVER inferred from a
  // star count or a trade. `licensed`/`insured` are strict booleans (the caller
  // sets them only from a real, held signal); `yearsInBusiness` is a sane
  // positive integer or nothing. Each renders one pill in the band, or none.
  const yearsInBusiness = (() => {
    const n = numOrNull(o.yearsInBusiness);
    return n !== null && n >= 1 && n <= 200 ? Math.round(n) : null;
  })();
  const licensed = o.licensed === true;
  const insured = o.insured === true;

  // THEIR COLOUR (2026-08-12). The measured accent from the client's own brand
  // — the same verified hex the mirror itself wears — marks what is THEIRS in
  // this email, against WSS blue for what is OURS. design.clientAccent()
  // handles everything a raw hex can do wrong: unparseable or design-lock
  // forbidden falls back to the WSS accent (colour is decoration, not a
  // claim), and every returned variant already clears WCAG on the surface it
  // is named for. `measured` stays false on fallback so nothing below can
  // pretend a default is their brand.
  const theirs = design.clientAccent(o.brandColor);

  // The plain-text twin of the HTML headline inside the grade card. Written
  // once, here, so the two halves cannot drift into saying different things
  // about the same measurement. Only ever emitted when `report` is set — see
  // the text array at the bottom of this file.
  // THE CARD NEEDS BOTH, IN BOTH DIRECTIONS (2026-08-07).
  //
  // A grade needs a report: without the link, "We measured your site at D
  // (41/100)" is an unsourced accusation the reader cannot check.
  //
  // And a report needs a grade: with a reportUrl and no measured letter the
  // card would claim to have measured them backed by nothing — and on 6 of 20
  // stored reports the page it opens reads "Analysis in progress". A grade we
  // could not read is a card that has nothing to say, so the card goes.
  //
  // `roadMap` is that AND, computed once, and it gates the HTML card, the
  // bars, the reasons and every line of the plain-text half. One expression,
  // so the two halves cannot disagree about whether this block exists.
  const roadMap = grade ? report : "";
  const gradeScoreText = gradeScore !== null ? ` (${gradeScore}/100)` : "";
  const textGradeLine = goalGrade
    ? `We measured your site at ${grade ? `a ${grade}${gradeScoreText}` : "below par"}. We have a road map to get you to ${goalGrade}.`
    : `We measured your site${grade ? ` at ${grade}${gradeScoreText}` : ""} — and your road map is already written.`;

  // Riley's free-call line. Resolved by the CALLER (lib/riley-line.js
  // resolveRileyLine) exactly like every other env-only phone in this
  // codebase — this file never reads process.env and never hardcodes a
  // number. An unparseable or absent value removes the whole block; it is
  // never a placeholder.
  const riley = normalizePhone(o.rileyPhone) || { telHref: "", display: "", e164: "" };

  // Optional, forward-compatible surfaces other tracks render through this
  // same composer. Each is a plain https URL; absent removes its block.
  const connectMagicLink = httpsOnly(o.connectMagicLink);
  const countdownGifUrl = httpsOnly(o.countdownGifUrl);

  // ----------------------------------------------------------- THE DASHBOARD
  //
  // WHAT THE DOOR ACTUALLY OPENS WITH — MEASURED AGAINST PRODUCTION, NOT READ.
  // Probed 2026-08-11 against https://wss-ai.com, every path, in order:
  //
  //   * EMAIL + PIN -> 200 with a scoped token. This is the door.
  //     POST /api/connect/dashboard-login {email, pin} for a provisioned row
  //     answered 200 {"ok":true,...,"scoped":true} on the live host. Both
  //     fields are required (either one missing -> 400), and
  //     apps/labs-site/dashboard/index.html only ever posts that pair.
  //
  //   * THE CLIENT ID OPENS NOTHING. Sent as the email and again as the PIN:
  //     401 invalid_credentials both ways. The ID is Riley's — the phone agent
  //     recomputes clientReferenceCode() to resolve a spoken code — and this
  //     email therefore names it only beside Riley's number. Telling a
  //     customer to "log in with your Client ID" would fail on the first try.
  //
  //   * THE MAGIC LINK CANNOT BE MINTED FROM HERE. GET /api/connect/verify-link
  //     answered 401 bad_signature for tokens signed with either secret this
  //     process can hold — production signs with its own. No one-click button.
  //
  // So the door prints the two things that DO work, literally: the address the
  // access row was written under, and the PIN whose sha256 is that row's
  // pin_hash. Caller-supplied on the same terms as connectMagicLink — only a
  // caller that has PROVISIONED the row may pass them (lib/email.js awaits
  // prospectMagicLink() before composing), because a PIN printed without a row
  // behind it is a lock with no key cut for it.
  //
  // BOTH OR NEITHER. One without the other is half a sign-in, and the login
  // refuses a half — so `dashboardDoor` is the AND, and it gates the sign-in
  // card and the plain-text half together. IT NO LONGER BLANKS THE SLOT
  // (2026-09-03): the dashboard CARD always renders — provisioned is the
  // sign-in card, unprovisioned is the claim-path CTA (freeBackendClaim) —
  // while the door itself (PIN plate, sign-in line, HOW TO GET IN row) stays
  // exactly this AND.
  const dashboardUrl = httpsOnly(o.dashboardUrl);
  const dashboardEmail = String(o.dashboardEmail || "").trim();
  const dashboardPin = String(o.dashboardPin || "").trim();
  const dashboardDoor = Boolean(dashboardUrl && dashboardEmail && dashboardPin);
  // THE ONE-TAP DOOR (owner, 2026-08-13: "I don't see the direct link for the
  // dashboard"). prospectMagicLink() mints a signed #t= link that the dashboard's
  // tryMagicLink() consumes to log the reader straight in — no email, no PIN to
  // type. lib/email.js provisions it on the same send that writes the PIN row, so
  // when it is present the door leads with a real BUTTON and demotes the email+PIN
  // to a manual fallback. Absent (no signing secret / no id) => the door falls
  // back to the type-it-in form exactly as before. https-only, per-prospect.
  const dashboardMagicLink = httpsOnly(o.dashboardMagicLink);
  // "https://wss-ai.com/dashboard" reads as machinery; "wss-ai.com/dashboard"
  // reads as a place. The href keeps the scheme, the label drops it.
  const dashboardLabel = dashboardUrl.replace(/^https:\/\//i, "").replace(/\/+$/, "");
  // THE BUY LINK, AND WHY IT IS HERE AT ALL.
  //
  // This email states a price as its largest object and gives the reader a way
  // to act on it. IT IS NOT A COLD CARD-ASK: the site is built, live, and
  // linked above this button, and the price it acts on is already printed.
  // ABSENT REMOVES THE BLOCK, exactly like every other option in this file.
  // The caller mints through prospectCheckoutUrl(), which returns "" with no
  // signing secret and "" with no prospect id, so an unconfigured environment
  // renders no button rather than a link that 401s in a stranger's browser.
  const checkoutUrl = httpsOnly(o.checkoutUrl);
  // An animated hero loop is a nicer "after" than a static screenshot of the
  // same moment, so it wins the slot when supplied — but it is still just an
  // <img src>, so it must be an actual asset URL (an animated GIF, or a
  // poster frame), never raw video.
  const afterAnimShot = httpsOnly(o.afterAnimUrl);
  // THE ALIVE THUMBNAIL (owner, 2026-08-16). The factory captures a motion
  // loop of the built site (lib/line-motion-shot: the prospect's own hero
  // playing, 1.5s at 12fps, encoded GIF), and the email's right-hand phone
  // should SHOW that motion so the prospect sees the site is alive. VIDEO
  // TAGS ARE NOT EMAIL-SAFE — <video> is stripped or un-played across most
  // mail clients (no Gmail web support, no Outlook desktop support), which is
  // exactly why the capture pipeline encodes an animated IMAGE and why this
  // slot takes a GIF/animated asset URL, never an mp4. `motionShotUrl` is the
  // explicit option; when it is absent the already-minted loop (afterAnimUrl,
  // lib/email.js shotUrl("gif"), minted fail-closed on anim_sha) fills the
  // slot, so the live path needs no new wiring. First-party host enforced
  // here too — the same allowlist law every <img> in this file lives under.
  // Absent loop => the static phone capture stays, never a fake, never a
  // spacer (the loop is the capture budget's first-drop by design).
  const firstPartyAsset = (u) => {
    const https = httpsOnly(u);
    return /^https:\/\/(?:[a-z0-9-]+\.)*wss-ai\.com\//i.test(https) ? https : "";
  };
  const motionShot = firstPartyAsset(o.motionShotUrl) || firstPartyAsset(afterAnimShot);
  // HONEST MOTION. The generator (lib/line-motion-shot) has TWO lanes: "hero"
  // — the client's own hero video really playing, seek-driven — and "pan", a
  // scripted scroll it falls back to when the hero is dead. Both encode to the
  // same GIF shape, and until now every motion caption below fired on
  // `motionShot` truthiness alone, so a pan over a static page went out
  // badged "live footage". The lane travels beside afterAnimUrl
  // (proofShotRecord.anim_lane -> proofCta -> the mapper's allowlist), and
  // ONLY "hero" earns the live-video words; the pan, an explicit
  // motionShotUrl with no lane, and rows captured before the lane was
  // recorded all say "preview" — the GIF still ships, the claim does not.
  const motionIsLive = Boolean(motionShot) && String(o.afterAnimLane || "").trim().toLowerCase() === "hero";
  // THE MIRROR AT 390, IN A PHONE FRAME (owner walkthrough, 2026-08-12):
  // "so they really see how much better it looks on their mobile phone."
  // Real pixels from the new-mobile capture variant, cache-busted at the mint
  // like every other shot; absent removes the whole pair.
  const mobileShot = httpsOnly(o.mobileImage);
  // THEIR site at the same 390 (owner, next pass): "show their mobile view...
  // so they can see the difference between ours and theirs, not just what
  // ours looks like on both." Minted by lib/email.js shotUrl("old-mobile")
  // behind digest + identity + current-website gates; absent means the block
  // ADAPTS to the ours-only phone/desktop pair below — never a spacer.
  const beforeMobileShot = httpsOnly(o.beforeMobileImage);

  // ─────────────────────────────────────────────────────────────────────────
  // MOSAIC V2 — BLUE, now on the REAL BRAND HUES (polish v2, 2026-09-02). The
  // owner's "more color" pass named the kit values outright — blue #4A6CF7 →
  // violet #7C6CF6, green #34D399, ink #131318 — so the local shadow now reads
  // packages/wss-brand-system/tokens.css instead of the older #2563EB. Navy
  // #0B1526 ink panels stay; gold #F59E0B stays reserved for the rating stars
  // ONLY. Nothing above this line reads PALETTE (verified), so the shadow
  // cannot land in a temporal-dead-zone. The client's own measured colour
  // still comes from design.clientAccent() and still marks what is THEIRS —
  // that is deliberately not shadowed.
  const PALETTE = {
    page: "#EDF1F7",
    panel: "#FFFFFF",
    ink: "#0F172A",
    muted: "#64748B",
    accent: "#4A6CF7",
    success: "#0E6B52",
    danger: "#C94C4C",
    line: "#E2E8F0",
    shelf: "#D8DEE8",
    subtle: "#F8FAFC",
    inkPanel: "#0B1526",
    inkPanelLine: "#1B3055",
    inkPanelInk: "#E9EEF6",
    inkPanelMuted: "#9FB2CE",
  };
  const A = PALETTE.accent;
  const onAccent = readableOn(A);
  // THE BRAND RAMP (polish v2). VIOLET is the far end of the kit's signal
  // gradient (#4A6CF7 → #7C6CF6) — it closes every primary button's ramp and
  // paints the section rules, so the accents lead the eye blue → violet the
  // way the brand kit draws them. GREEN/GREEN_DEEP are the kit's pulse ramp
  // (#34D399 → #0E6B52) and are RESERVED: the price tags, the waived badge,
  // the grand-total band and the call-Riley actions — money and motion, never
  // decoration. INK_TILE is the kit's carbon #131318: the grade tile's face.
  const VIOLET = "#7C6CF6";
  const GREEN = "#34D399";
  const GREEN_DEEP = "#0E6B52";
  const INK_TILE = "#131318";
  const TAG_BG = `background:${GREEN_DEEP};background-image:linear-gradient(135deg,${GREEN_DEEP} 0%,${design.mix(GREEN, GREEN_DEEP, 0.5)} 100%)`;
  // The lighter blue that reads on the navy panels (headline highlight, eyebrows
  // on dark). Not an accent a label ever sits on — decoration only.
  const ACCENT_LIGHT = "#8FB0FF";
  // STRUCTURAL TONES, DERIVED — never an ad-hoc hex at the call site. The
  // pressed bottom edge of the ink road-map button, the one-step-softer ink of
  // a receipt row, and the light accent wash a white card's chip sits on. Same
  // values the file used to hardcode (#060B14 / #334155 / #EFF6FF), now named
  // and mixed from the PALETTE so a palette change carries them.
  const INK_BUTTON_TO = design.mix(PALETTE.ink, "#000000", 0.55);
  const SLATE = design.mix(PALETTE.ink, PALETTE.muted, 0.3);
  const ACCENT_WASH = design.mix(A, "#FFFFFF", 0.92);
  // The bottom of the primary buttons' gradient ramp — the kit's signal
  // gradient settled into deep violet (polish v2): every primary button now
  // ramps brand blue #4A6CF7 → violet, exactly the way tokens.css draws it.
  const ACCENT_TO = design.mix(VIOLET, PALETTE.inkPanel, 0.32);

  // ── THE LIQUID GLASS KIT (v4, owner: "redo V2 with a real liquid glass look
  // and feel to the whole thing"). The recipe is the brand's own
  // wss-liquid-glass-gallery treatment (lib/gallery-page-final.js): a 145°
  // white→violet wash, a 1px rgba-white edge, an INSET 1px white top-edge
  // highlight, and deep stacked shadows. EMAIL REALITY CHECK: backdrop-filter
  // renders nowhere in email (Gmail strips it, Outlook's Word engine never
  // had it), so the frost is FAKE — layered translucent gradients painted
  // onto the liquid page field, exactly as the gallery does for its own
  // no-blur fallback. Outlook desktop drops background-image and keeps the
  // first solid fill + the inset highlight: a soft tinted panel, the
  // sanctioned degrade.
  const GLASS_PAGE = "background:#E7EBF6;background-image:linear-gradient(165deg,#DCE6F9 0%,#E9E3FB 52%,#DFF2EC 100%)";
  // The 600 shell: a frosted sheet floating on the liquid field.
  const GLASS_SHEET = "background:#FBFCFF;background-image:linear-gradient(160deg,rgba(255,255,255,.86) 0%,rgba(255,255,255,.55) 55%,rgba(124,108,246,.10) 100%);border:1px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(43,66,133,.05),0 26px 60px rgba(37,58,142,.16),inset 0 1px 0 #FFFFFF";
  // Light glass: every white card of the v2 structure, frosted.
  const GLASS_CARD = "background:#FFFFFF;background-image:linear-gradient(145deg,rgba(255,255,255,.94) 0%,rgba(255,255,255,.62) 48%,rgba(124,108,246,.12) 100%);border:1px solid rgba(255,255,255,.98);box-shadow:0 0 0 1px rgba(43,66,133,.06),0 12px 30px rgba(37,58,142,.13),inset 0 1px 0 #FFFFFF,inset 0 -16px 32px rgba(124,108,246,.05)";
  // Dark glass: the navy panels keep their v2 tints and gain the glass edge,
  // the inner glow and the deep pool.
  const GLASS_DARK_FINISH = "border:1px solid rgba(255,255,255,.20);box-shadow:0 18px 44px rgba(15,25,60,.38),inset 0 1px 0 rgba(255,255,255,.16),inset 0 0 46px rgba(124,108,246,.13)";
  // The baked light-sweep for buttons (the shimmer). An ANIMATED sweep needs
  // <style>/keyframes, which Gmail strips and Outlook ignores — so the sweep
  // is baked: a diagonal white highlight painted as the top background layer,
  // static everywhere, and the inset top edge does the glass lift.
  const SHEEN = "linear-gradient(105deg,rgba(255,255,255,.36) 0%,rgba(255,255,255,.10) 26%,rgba(255,255,255,0) 47%)";
  // THE "TALK TO RILEY NOW" WEB-CALL LINK. https-only; absent on every live send
  // today (no VAPI web-voice embed URL is wired), so the button falls back to the
  // live-site chat surface / the tel line below — never a dead #anchor.
  const talkToRileyUrl = httpsOnly(o.talkToRileyUrl);
  // WHERE THE RILEY BUTTONS GO — AND WHAT THEY NEVER DO (owner final-polish
  // pass, 2026-09-03). TWO DISTINCT AFFORDANCES, BY LAW:
  //   * every big Riley BUTTON opens the WEB surface: the VAPI web-call
  //     interface (talkToRileyUrl — the talk-to-Riley web URL hosting the VAPI
  //     web widget) when a caller provisioned one, else the mirror's own live
  //     chat surface (#chat). A button NEVER dials — the old final fallback to
  //     riley.telHref is retired. `preview` is always present on the live send
  //     path, so the button always has an https destination and never a dead
  //     #anchor.
  //   * the PHONE NUMBER is its own separate TEXT link (underlined, smaller
  //     than the buttons, 18px so it stays a real tap target) rendered beside
  //     the button it belongs to. Dialling is what the link is for; the button
  //     never competes with it.
  // (Defined here, ABOVE the doors array that consumes it — the old definition
  // sat below the doors and would have been a temporal-dead-zone throw.)
  const talkRileyHref = talkToRileyUrl || (preview ? `${preview}#chat` : "");
  // The phone-dial text link. 18px bold (the owner's phone-number floor —
  // "easy to tap on mobile"), underlined so it reads as a link and not a
  // button, green-deep ink (the call-Riley colour), padded so the tap area
  // clears 44px. NO glyph: the big button above it already carries one, and
  // every glyph+nbsp cluster here widened the number's one-line floor — which
  // at 390 is exactly what pushed the doors card past the gutter (measured:
  // 194px floor → 371px shell against 366 available). The bare underlined
  // number is the affordance. One line, always — nowrap stays, because a phone
  // number never wraps mid-number. Exists only when the line exists — absent
  // removes it.
  const telTextLink = () => (riley.telHref
    ? `<a href="${esc(riley.telHref)}" style="display:inline-block;padding:10px 8px;font-family:${FONT_STACK};font-weight:800;font-size:18px;letter-spacing:.02em;color:${GREEN_DEEP};text-decoration:underline;text-underline-offset:3px;white-space:nowrap">${esc(riley.display)}</a>`
    : "");

  // PROPERLY CAPITALIZED, BENEFIT-LED (owner walkthrough, 2026-08-12). The
  // reference he gave is CarsForSale's "Don't gamble with your inventory" —
  // sell the feeling, not the fact. The feeling here is the winning lottery
  // ticket: the work is DONE and it is THEIRS.
  //
  // NOTE ON THE LIVE PATH: lib/email.js overwrites the proof-step subject with
  // pchSubject()'s rotation (lib/outreach-email-v2.js SUBJECT_POOL) — this
  // string ships on direct composer callers and smoke paths. The two are kept
  // in the same voice on purpose, so neither path embarrasses the other.
  const subject = business
    ? `${business}, your new website is already built`
    : "Your new website is already built";
  const preheader = "Built and published before you pay a dollar. Takes 5 seconds to look.";

  const reviewLine = rating && reviews
    ? `Your ${esc(rating)}-star Google rating and ${esc(reviews)} reviews, shown on the page`
    : "Your Google rating and reviews, shown on the page";

  // Plain-language bullets, used in the plain-text part below — the same facts
  // the HTML chips carry, without the markup.
  //
  // TRUTH PASS 2026-08-07 (V4 assembly). Four claims were removed or narrowed
  // because they could not be verified against the shipped product:
  //
  //   * "your own domain included" -> "Hosting and SSL included".
  //     lib/domains.js is a REAL Vercel registrar integration but it is
  //     dry-run unless DOMAIN_PURCHASE_ENABLED=true, and the required
  //     DOMAIN_CONTACT_* fields are unset. Nothing buys a domain today.
  //   * "Directory listings, indexed and kept current" -> REMOVED. No
  //     directory submission exists anywhere in this codebase and the
  //     rendered mirror contains no directory surface.
  //   * "Your competitors researched, inside your pages" -> moved to the
  //     REPORT, where it is true (the Signal report ranks them against the
  //     other businesses scanned in their area). The rendered mirror contains
  //     no competitor content at all.
  //   * "call or text" -> "call". The Riley line is a VAPI voice number with
  //     no SMS provisioning, so a text would go nowhere.
  //   * "across seven measured areas" -> "graded area by area". THE READER CAN
  //     COUNT THIS, and the link that settles it is two lines below. Read back
  //     2026-08-09 through lib/report-grade.js across all 16 structurally-real
  //     report URLs in the store: eleven reports score eight categories, four
  //     score seven, one scores one. A count cannot be made true here, so the
  //     email names none.
  //
  // THE $1,000 ANCHOR (2026-08-12) is the owner's own line for the report —
  // "your $1,000 custom search report with a road map" — the same class of
  // value anchor as the $4,000–$8,000 agency range, stated by the person who
  // owns pricing. It decorates the report the $149 already includes; it does
  // not change what the report is or when it is linked.
  const bullets = [
    "A modern site that looks right on every phone",
    "Hosting and SSL included",
    reviewLine,
    'Google and Apple Maps, and "near me" searches',
    "Your $1,000 custom search report with a road map — a health report on your current site, graded area by area",
    ...(marketProvisional ? [] : ["Your local competitors ranked, in that report"]),
    // NOT "so enquiries reach you": api/preview-contact.js mails the AGENCY's
    // GHOST_AGENCY_OWNER_EMAIL, and there is no per-client routing anywhere in
    // the codebase. The form is real and on every page; who it lands with
    // today is not what the sentence implied.
    // Same narrowing as the chip, and for the same measurement: a form lives
    // on one page per mirror; a tap-to-call button is on all of them.
    "A quote form, plus a tap-to-call button on every page",
    "Riley: call any time, edits made live on the phone",
    "Your own dashboard app: ask for a change in plain words, watch it happen",
  ];

  // ONE TYPE SCALE (design pass 2026-08-19). The owner's "CSS is still not
  // where it should be" read traced to twenty-odd ad-hoc pixel sizes — 19,
  // 16.5, 16, 15.5, 14.5, 14, 13.5, 12.5, 11.5, 10.5 all living in one email.
  // Every text size below now sits on this ladder and nowhere else:
  //   30 display · 24 numeral · 17 title · 15 lead · 13 body · 12 caption ·
  //   11 small · 10 micro
  // Deliberate exceptions, each a drawn object rather than running text: the
  // 62px price, the 44px PIN/grade plates, 20px emoji icons, the pinned
  // goldStars sizes (20/15/13 — test/email-stars-and-review-selection), and
  // the micro labels inside the two drawn PIN/ID plates (8.5/9px art).
  const body = (px, color = PALETTE.ink, weight = 400) =>
    `font-family:${FONT_STACK};font-size:${px}px;line-height:1.5;font-weight:${weight};color:${color}`;

  // ONE SECTION GUTTER. Every stacked card ends on the same 16px beat —
  // the mixed 12/14/16/18 bottoms were half of the "spacing is off" read.
  const GUTTER = "padding-bottom:16px";

  const cell = (inner, style = "") => `<tr><td style="padding:0 24px;${style}">${inner}</td></tr>`;

  // BUTTONS WITH A VIBE. Owner: "these buttons just look very flat and plain."
  // A linear-gradient background renders in Apple Mail, Gmail (web + iOS),
  // Outlook mobile and every webmail client; Outlook DESKTOP ignores it and
  // falls back to the flat `background` declared first. The inset highlight
  // and the drop shadow give it the lift; both degrade to nothing rather than
  // to a broken box. Letter-spacing .04em on the 800-weight label is the
  // 2026-08-07 fix for "these buttons — the font. I hate it."
  // SHARPNESS PASS 2026-08-16: the drop shadow is a real one now — a 3px
  // pressed edge under the button plus a soft dark pool beneath it (both from
  // the button's own ramp, both alpha-hex which every client that keeps
  // box-shadow understands and every other client drops cleanly).
  //
  // POLISH MOCK 2026-09-02 — THE CENTRING PASS (owner: the "Open your live
  // preview" buttons' text is NOT CENTRED). The old button was a bare
  // `display:block` <a> carrying both the centering and the vertical rhythm in
  // its own inline styles. The Word engine (Outlook desktop) drops
  // `display:block` on an anchor, so the button collapsed to a left-attached
  // tab whose `text-align:center` now applied to nothing, and `line-height` —
  // the vertical centring — stopped applying to the box it sat in. The fix is
  // the bulletproof pattern: the button IS a one-cell table whose CELL carries
  // align="center" + valign="middle" + the height, so the label is centred on
  // both axes by the table engine every client has, and the <a> is a plain
  // inline child. `align="center"` on the table centres the whole button in
  // its wrapper; the wrappers below also set text-align:center so webmail that
  // strips the attribute still centres it.
  //
  // TWO WIDTHS, EXPLICITLY. A pill (default) shrink-wraps its label and
  // centres — right for every secondary CTA. `full: true` (the hero preview
  // and the dashboard door) renders the table with an explicit width="100%",
  // so the bar still spans the card like the old primary button did.
  //
  // THE LABEL WRAPS. The old anchor carried white-space:nowrap and drew its
  // height from line-height — which made the button's min-content width the
  // WHOLE one-line label, and a shrink-wrapped nowrap pill is exactly how an
  // email starts scrolling sideways at 390 (measured: 421px of layout from the
  // hero CTA alone). Now the vertical rhythm comes from the CELL — height attr
  // + valign="middle" — and the anchor is line-height:1.35 with no nowrap, so
  // the worst case anywhere is a two-line centred label on a 320px screen,
  // never a pushed layout. Same mechanism that fixes Word's dropped
  // display:block also fixes the min-content push: the table engine owns both.
  // POLISH V2 (owner pass, 2026-09-02 — "small detail, finite things"): one
  // button law for the whole email. Height/radius/shadow are now chosen from
  // two consistent presets (primary 56, secondary/door 50-54, radius 12, the
  // same two-layer shadow), the ramp always runs blue → violet, and `nowrap`
  // exists for the ONE label that must never wrap mid-number: a phone number.
  //
  // THE LIGHT-SWEEP (owner final-polish pass, 2026-09-03). The two primary
  // CTAs — OPEN YOUR LIVE PREVIEW and START MY PLAN — take `sweep: true`: a
  // diagonal white band layered ABOVE the sheen, parked just off the button's
  // right edge in the inline styles (background-size 220%, no-repeat), so the
  // STATIC state every client falls back to is the same subtle baked diagonal
  // highlight the other buttons wear. Where a client keeps <style> AND animates
  // (Apple Mail and the WebKit mobile clients), the head's `wss-sweep` rule
  // walks that band across the button every few seconds; Gmail strips <style>
  // and Outlook desktop ignores animation and drops background-image (flat
  // fill + border remain), so the degrade is the sanctioned one — highlight
  // where gradients render, motion where animation renders, never broken.
  const SWEEP_BAND = "linear-gradient(115deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0) 42%,rgba(255,255,255,.5) 50%,rgba(255,255,255,0) 58%,rgba(255,255,255,0) 100%)";
  const gradButton = ({ href, label, from, to, ink, size = 17, height = 56, radius = 12, letterSpacing = ".04em", pad = 26, full = false, nowrap = false, sweep = false }) => `
    <table role="presentation"${full ? ' width="100%"' : ' align="center"'} cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate${full ? ";width:100%" : ""}"><tr>
      <td${sweep ? ' class="wss-sweep"' : ""} align="center" valign="middle" bgcolor="${from}" height="${height}" style="background:${from};background-image:${sweep ? `${SWEEP_BAND},` : ""}${SHEEN},linear-gradient(180deg,${design.mix(from, "#FFFFFF", 0.18)} 0%,${from} 45%,${to} 100%);${sweep ? "background-size:220% 100%,100% 100%,100% 100%;background-position:130% 0,0 0,0 0;background-repeat:no-repeat;" : ""}border:1px solid rgba(255,255,255,.34);border-radius:${radius}px;box-shadow:inset 0 1px 0 rgba(255,255,255,.38),0 3px 0 ${design.mix(to, "#000000", 0.3)},0 10px 22px ${design.mix(to, "#000000", 0.45)}2E;text-align:center;vertical-align:middle">
        <a href="${esc(href)}" style="display:inline-block;padding:0 ${pad}px;font-family:${FONT_STACK};font-weight:800;font-size:${size}px;line-height:1.35;color:${ink};text-decoration:none;letter-spacing:${letterSpacing};text-align:center${nowrap ? ";white-space:nowrap" : ""}">${label}</a>
      </td>
    </tr></table>`;

  // A CHIP: one included fact as a small pill. The eight-row benefit grid of
  // the long form, compressed to a wrapping row of pills — same claims, same
  // narrowings, one fifth the height. Inline-block spans wrap on their own in
  // every client, need no media query, and can never set a min-content width
  // wider than their longest word — which is how this row stays inside 390.
  const chip = (label, { color = PALETTE.ink, line = PALETTE.line, bg = PALETTE.subtle } = {}) =>
    `<span style="display:inline-block;background:${bg};border:1px solid ${line};border-radius:999px;padding:5px 10px;margin:0 6px 6px 0;font-family:${FONT_STACK};font-size:11px;line-height:1.35;font-weight:700;color:${color}">${label}</span>`;

  // The same facts as `bullets`, worn as pills. The Maps row's vendor-mark
  // <img> apparatus from the long form is gone with the grid — a pill has no
  // icon slot, and the two vendor icons were never first-party anyway.
  // MOSAIC V2: the 6-card showcase now carries the feature claims (including the
  // pinned "tap-to-call on every page" and "graded area by area"), so this row is
  // reduced to the ONE pill the mapper test pins — the rating line — reinforcing
  // "your reviews, shown live" beneath the showcase. rating+reviews -> "Your 4.9
  // rating — 407 reviews, shown live"; absent -> the generic line, never a number
  // we were not given. The text half's `bullets` still carries every claim.
  const chips = chip(rating && reviews
    ? `&#9733; Your ${esc(rating)} rating &mdash; ${esc(reviews)} reviews, shown live`
    : "Your Google rating and reviews &mdash; shown live");

  // THE GREEN PRICE TAG (owner pass v2, 2026-09-02: "green dollar price tags
  // vs plain ones — every price figure gets a green price-tag treatment").
  // One drawing, used everywhere a dollar figure appears: white bold figure on
  // the kit's emerald pulse ramp (TAG_BG: #0E6B52 → #34D399), rounded like a
  // physical tag. `mono` keeps the receipt voice inside the comparison table;
  // `size` scales the tag, never the colour. The one figure that does NOT wear
  // a small tag is the $149 — it gets the tag SHAPE at hero size instead (see
  // priceTagPlate), because the big price stays the loudest thing in the email.
  const priceTag = (figure, { size = 11.5, pad = "3px 9px", radius = 8, mono = false, weight = 800 } = {}) =>
    `<span style="display:inline-block;${TAG_BG};border-radius:${radius}px;padding:${pad};font-family:${mono ? design.FONT_MONO : FONT_STACK};font-size:${size}px;line-height:1.3;font-weight:${weight};letter-spacing:.02em;color:#FFFFFF;white-space:nowrap">${figure}</span>`;

  // afterAnimShot (an animated hero loop) wins the "after" slot over the
  // static afterShot when supplied — same slot, same caption, better proof.
  const afterDisplay = afterAnimShot || afterShot;

  // ONE ANCHOR USED TO WRAP BOTH HALVES (fixed 2026-08-11).
  //
  // `<a href="${preview}">` opened above the before <td> and closed below the
  // after <td>, so every pixel of the prospect's OWN site — captioned
  // "Before", greyscaled, unmistakably theirs — was a click target for our
  // mirror. Two real sends went out that way. Now each half owns its own
  // anchor and its own destination:
  //   BEFORE -> their site, or NO LINK AT ALL when we have no https URL for it.
  //   AFTER  -> the live preview, or no link when there is no preview.
  // The two can never share a href: the before anchor is dropped outright if
  // its destination is the preview (which would mean the caller handed us our
  // own mirror as "their current site" — a fact that is wrong upstream, not a
  // link to render).
  const sameDestination = (a, b) => {
    const norm = (u) => String(u || "").trim().replace(/\/+$/, "").toLowerCase();
    return Boolean(norm(a)) && norm(a) === norm(b);
  };
  const beforeHref = sameDestination(currentSite, preview) ? "" : currentSite;
  // An empty href is a dead click and a structural test failure, so a missing
  // destination removes the anchor rather than emitting one.
  const linkWrap = (href, inner) => (href
    ? `<a href="${esc(href)}" style="text-decoration:none;display:block">${inner}</a>`
    : inner);
  // The desktop strip: smaller than the long form's (the PHONE pair is the
  // prominent comparison now, per the owner's order), same anchors, same
  // captions, same greyscale-before treatment. The AFTER caption bar wears
  // THEIR measured accent — the new site is their brand, not ours.
  const beforeInner = `<img src="${esc(beforeShot)}" width="268" height="112" alt="${esc(business)} site before" style="display:block;width:100%;height:112px;object-fit:cover;filter:grayscale(1)">
              <div style="font-family:${FONT_STACK};font-weight:700;font-size:10px;letter-spacing:.14em;color:${PALETTE.muted};padding:7px 10px;background:${PALETTE.subtle};text-transform:uppercase">Before</div>`;
  const afterInner = `<img src="${esc(afterDisplay)}" width="${beforeShot ? 268 : 536}" height="112" alt="${esc(business)} new site" style="display:block;width:100%;height:112px;object-fit:cover">
              <div style="font-family:${FONT_STACK};font-weight:800;font-size:10px;letter-spacing:.14em;color:${readableOn(theirs.base)};padding:7px 10px;background:${theirs.base};text-transform:uppercase">After &nbsp;&#9658;&nbsp; open it live</div>`;
  const heroBlock = afterDisplay ? `
    <tr><td style="padding:0 24px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="border-collapse:separate;${GLASS_CARD};border-radius:12px;overflow:hidden">
        <tr>
          ${beforeShot ? `<td width="50%" style="padding:0">
            ${linkWrap(beforeHref, beforeInner)}
          </td>` : ""}
          <td width="${beforeShot ? "50%" : "100%"}" style="padding:0">
            ${linkWrap(preview, afterInner)}
          </td>
        </tr>
      </table>
    </td></tr>` : "";

  // ------------------------------------------------- ON A PHONE, UP TOP
  //
  // Owner walkthrough 2026-08-12: "so they really see how much better it
  // looks on their mobile phone", then "show their mobile view... so they can
  // see the difference between ours and theirs" — and in the compression
  // pass, the phone pair is THE opening image of the email.
  //
  // ONE BLOCK, TWO SHAPES, BY EVIDENCE — never a spacer, never a stale image:
  //
  //   THEIRS-VS-OURS (both phone captures on record): the prospect's OWN site
  //   at 390 in a phone frame beside OUR mirror at 390 in the same frame.
  //   Real 390x844 viewport, no zoom tricks, full colour. Each half links to
  //   ITS OWN site (theirs -> their site via beforeHref — already "" when
  //   their URL is missing or suspicious; ours -> the live preview). OUR
  //   frame and label wear THEIR measured accent: the new site is their
  //   brand, and the colour against the grey "today" half is the pop.
  //
  //   OURS-ONLY (their phone capture not on record): our 390 capture in a
  //   phone frame beside the desktop still of the same build, both linking to
  //   the preview. A missing capture adapts the block; it never blocks the
  //   email and never leaves a hole.
  //
  // 390px MATH, RESIZED FOR LEGIBILITY (2026-09-05, audit A4 defect F). The
  // pair used to be two FIXED 132/138px columns inside a 276px wrapper — and a
  // 390px capture shown at 120px wide with a dark-slab hero was an unreadable
  // near-black rectangle (audit A4's "email-side miniature amplifier", 34/34
  // slots). The phone <img> is now 220px wide — 390:844's exact ratio at
  // 220x476 — inside a 234px bezel (img + 5px pad + 2px border), and the two
  // halves sit in a 480px wrapper: side by side wherever 480 fits (the 600
  // shell's card), and WRAPPING below one another where it does not (every
  // phone read), exactly the aligned-table mechanism this block already used —
  // side-by-side was kept for wide reads; legibility is no longer traded for
  // it. Nothing is fixed beyond its max: every table carries width:100%;
  // max-width (honoured by every phone client; desktop Outlook falls back to
  // the width attribute, where 234/480 still fit the 600 shell), and the imgs
  // carry max-width:100%;height:auto so a narrow read scales the picture, never
  // pokes it out of the card. Nothing is nowrap; the email cannot scroll
  // sideways.
  const PHONE_SHOT_W = 220;
  const PHONE_SHOT_H = 476;
  const phoneFrame = ({ shot, alt, line = PALETTE.inkPanelLine }) => `<div style="background:${PALETTE.inkPanel};border:2px solid ${line};border-radius:16px;padding:5px;box-shadow:0 12px 26px rgba(15,25,60,.30),inset 0 1px 0 rgba(255,255,255,.16)"><img src="${esc(shot)}" width="${PHONE_SHOT_W}" height="${PHONE_SHOT_H}" alt="${esc(alt)}" style="display:block;width:${PHONE_SHOT_W}px;max-width:100%;height:auto;object-fit:cover;object-position:top;border-radius:11px"></div>`;
  // BOTH captions wear the same plate (design pass 2026-08-19): the "today"
  // half used to be a bare line beside the accent-filled "new" badge, so the
  // two captions sat at different heights under identical bezels. Same box,
  // same padding, same radius — only the fill differs (neutral vs accent).
  const phoneLabel = (label, { bg = PALETTE.subtle, line = PALETTE.line, color = PALETTE.muted } = {}) => `<div style="margin-top:6px;text-align:center;background:${bg};border:1px solid ${line};border-radius:6px;padding:4px 2px;${body(10, color, 800)};letter-spacing:.1em;text-transform:uppercase">${label}</div>`;
  // One half of the pair as its own aligned (float) table. `pad` puts the
  // 6px gutter on the inner edge so the two halves read as one centred unit;
  // the 12px bottom pad gives the WRAPPED shape (narrow reads) its breathing
  // room without changing the side-by-side row.
  const phoneHalf = (side, inner) => `<table role="presentation" align="left" width="234" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:234px;border-collapse:collapse">
      <tr><td align="center" style="padding:0 ${side === "left" ? 3 : 0}px 12px ${side === "right" ? 3 : 0}px">${inner}</td></tr>
    </table>`;
  const mobilePairBlock = (preview && mobileShot && beforeMobileShot) ? cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${GLASS_CARD};border-radius:12px">
    <tr><td style="padding:16px 18px 0">
      ${eyebrow("ON A PHONE, SIDE BY SIDE.", A)}
      <div style="${body(15, PALETTE.ink, 800)}">Most of your customers are on their phone. Here is yours today, next to your new one.</div>
    </td></tr>
    <tr><td style="padding:14px 18px 6px">
      <table role="presentation" align="center" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;border-collapse:collapse"><tr><td>
        ${phoneHalf("left", `${linkWrap(beforeHref, phoneFrame({ shot: beforeMobileShot, alt: `${business || "Your"} site on a phone today` }))}
          ${phoneLabel("Your site on a phone today")}`)}
        ${phoneHalf("right", `${linkWrap(preview, phoneFrame({
    shot: motionShot || mobileShot,
    // "live video loop" is a claim about THEIR hero playing; a pan-lane GIF
    // (or one whose lane was never recorded) is a site preview, and says so.
    alt: motionIsLive ? `${business || "Your"} new site, live video loop`
      : motionShot ? `${business || "Your"} new site preview`
      : `${business || "Your"} new site on a phone`,
    line: theirs.base,
  }))}
          ${phoneLabel(motionIsLive ? "Your new site &mdash; live"
    : motionShot ? "Your new site &mdash; preview"
    : "Your new site on a phone", { bg: theirs.base, line: theirs.base, color: readableOn(theirs.base) })}`)}
      </td></tr></table>
    </td></tr>
    <tr><td style="padding:0 18px 16px">
      <div style="${body(12, PALETTE.muted)}">${motionIsLive
    ? "A real screenshot of your site today, next to your new one moving. Tap either one to open that site."
    : motionShot
      ? "A real screenshot of your site today, next to a preview of your new one. Tap either one to open that site."
      : "Both are real screenshots at the same phone size. Tap either one to open that site."}</div>
      ${motionIsLive ? `<div style="margin-top:8px;text-align:center"><span style="display:inline-block;background:${ACCENT_WASH};border-radius:999px;padding:5px 12px;font-family:${FONT_STACK};font-size:11px;font-weight:800;letter-spacing:.06em;color:${A};text-transform:uppercase">&#9654; Watch it move &mdash; live footage</span></div>` : ""}
    </td></tr>
  </table>`, GUTTER)
    // THE OURS-ONLY FALLBACK (no before-phone capture on record) is stacked
    // rows since 2026-09-05 (audit A4 defect F): the phone shot at the SAME
    // legible 220x476 the pair uses — the old 92x188 thumbnail was the other
    // unreadable miniature — with the desktop still full-width under it. Plain
    // tr/td rows, so Outlook's table-cell rendering needs nothing else, and
    // nothing fixed can poke out of the card.
    : (preview && mobileShot && afterShot) ? cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${GLASS_CARD};border-radius:12px">
    <tr><td style="padding:16px 18px 0">
      ${eyebrow("ON A PHONE. ON A DESKTOP.", A)}
      <div style="${body(15, PALETTE.ink, 800)}">Most of your customers are on their phone. Your new site is built for that.</div>
    </td></tr>
    <tr><td style="padding:12px 18px 4px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">
        <tr><td align="center" style="padding:0 0 14px">
          ${linkWrap(preview, phoneFrame({ shot: mobileShot, alt: `${business || "Your"} new site on a phone`, line: theirs.base }))}
          <div style="margin-top:6px;text-align:center;${body(10, PALETTE.muted, 800)};letter-spacing:.14em;text-transform:uppercase">Phone</div>
        </td></tr>
        <tr><td align="center">
          ${linkWrap(preview, `<img src="${esc(motionShot || afterDisplay)}" width="360" height="188" alt="${esc(business) || "Your"} new site on a desktop" style="display:block;width:100%;max-width:360px;height:auto;object-fit:cover;object-position:top;border:1px solid ${PALETTE.line};border-radius:10px">`)}
          <div style="margin-top:6px;text-align:center;${body(10, PALETTE.muted, 800)};letter-spacing:.14em;text-transform:uppercase">Desktop</div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 18px 16px">
      <div style="${body(12, PALETTE.muted)}">Same site, sized right for both. Tap either picture to open it.</div>
    </td></tr>
  </table>`, GUTTER) : "";

  // ------------------------------------------------------------ WHAT YOU GET
  //
  // Owner's section 2: "the features/perks graphically dense". Four dark
  // tiles — the site, the $1,000 report, Riley, the app — over one row of
  // chips carrying every remaining included fact. The tiles are
  // product-inclusion claims on exactly the terms the long form's grid rows
  // shipped (each names a thing the $149 includes for every customer, in the
  // narrowed wording the 2026-08-07/08 truth passes established); the chips
  // are the same eight claims the grid carried, unchanged.
  const tile = ({ title, line, art = "" }) => `<td width="50%" valign="top" style="width:50%;padding:0 3px 6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PALETTE.inkPanel};background-image:linear-gradient(165deg,${design.mix(PALETTE.inkPanel, VIOLET, 0.22)} 0%,${PALETTE.inkPanel} 46%,${design.mix(PALETTE.inkPanel, A, 0.16)} 100%);border:1px solid ${PALETTE.inkPanelLine};border-top:3px solid ${A};border-radius:10px">
      <tr><td style="padding:11px 12px 11px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
          <td valign="middle" style="font-family:${FONT_STACK};font-weight:900;font-size:14.5px;line-height:1.25;color:#FFFFFF;text-transform:uppercase;letter-spacing:.02em">${title}</td>
          ${art ? `<td width="34" align="right" valign="middle" style="width:34px">${art}</td>` : ""}
        </tr></table>
        <div style="margin-top:4px;${body(11.5, PALETTE.inkPanelMuted, 600)};line-height:1.4">${line}</div>
      </td></tr>
    </table>
  </td>`;
  // ----------------------------------------- ALREADY INSIDE YOUR NEW SITE (v2)
  //
  // MOSAIC V2 section 6, the "what you get" surface: six cards, each a real
  // included feature with the TYPICAL MARKET PRICE of that one piece bought
  // elsewhere as a chip (NOT a fee we charge — see VALUE_STACK's framing law).
  //
  // EMOJI GLYPHS, NEVER AN <img>. The email's image inventory is pinned
  // (test/email-truth-packet-adapter counts every <img>), so a picture here
  // would break it — and Gmail strips inline SVG regardless. Google / Apple Maps
  // are named in TEXT for the same reason: no first-party G/Maps PNG is hosted,
  // and a broken vendor SVG must never ship.
  //
  // Two pinned truth-claims are baked into the copy on purpose:
  //   * "tap-to-call on every page" — the claim that IS true everywhere
  //     (test/email-unbuilt-work-claims asserts it in the HTML), and
  //   * "graded area by area" — the report bullet (same test).
  // The reviews card names "Google reviews" ONLY with both trust numbers, so an
  // absent rating never prints an unweighted trust claim (the band-gate law).
  // POLISH V2 (more color + green tags): each card wears ONE brand accent as a
  // top rule — blue/violet alternating, the $1,000-report card green — the icon
  // sits in a tinted chip of the same hue, and the price chip is now the GREEN
  // PRICE TAG (priceTag): white bold figure on the emerald ramp, the same tag
  // every other dollar figure in the email wears.
  const showCard = ({ icon, title, line, chipText, dark = false, top = A }) => `<td width="50%" valign="top" style="width:50%;padding:0 3px 6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;height:100%;background:${dark ? PALETTE.inkPanel : PALETTE.panel};background-image:${dark ? `linear-gradient(165deg,${design.mix(PALETTE.inkPanel, VIOLET, 0.24)} 0%,${PALETTE.inkPanel} 48%,${design.mix(PALETTE.inkPanel, A, 0.18)} 100%)` : `linear-gradient(145deg,rgba(255,255,255,.94) 0%,rgba(255,255,255,.62) 48%,rgba(124,108,246,.12) 100%)`};border:1px solid ${dark ? 'rgba(255,255,255,.20)' : 'rgba(255,255,255,.98)'};border-top:3px solid ${dark ? A : top};border-radius:12px;box-shadow:${dark ? '0 18px 44px rgba(15,25,60,.38),inset 0 1px 0 rgba(255,255,255,.16),inset 0 0 46px rgba(124,108,246,.13)' : '0 0 0 1px rgba(43,66,133,.06),0 10px 26px rgba(37,58,142,.12),inset 0 1px 0 #FFFFFF'}">
      <tr><td style="padding:13px 13px 14px">
        <div style="padding-bottom:8px"><span style="display:inline-block;background:${dark ? design.mix(A, PALETTE.inkPanel, 0.55) : design.mix(top, "#FFFFFF", 0.9)};border:1px solid ${dark ? PALETTE.inkPanelLine : design.mix(top, "#FFFFFF", 0.7)};border-radius:10px;padding:5px 8px;font-size:19px;line-height:1">${icon}</span></div>
        <div style="font-family:${FONT_STACK};font-weight:800;font-size:15px;line-height:1.25;color:${dark ? "#FFFFFF" : PALETTE.ink};padding-bottom:5px">${title}</div>
        <div style="font-family:${FONT_STACK};font-weight:500;font-size:12px;line-height:1.45;color:${dark ? PALETTE.inkPanelMuted : PALETTE.muted};padding-bottom:10px">${line}</div>
        ${priceTag(chipText, { size: 10.5, pad: "4px 10px", radius: 999 })}
      </td></tr>
    </table>
  </td>`;
  const showcase = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed">
    <tr>
      ${showCard({ icon: "&#129302;", title: "On-site AI chat &amp; booking", line: "&ldquo;Ask Riley&rdquo; answers your customers and books jobs on your site, day and night.", chipText: "$99/mo elsewhere", top: A })}
      ${showCard({ icon: "&#128242;", title: "24/7 missed-call text-back", line: "Miss a call and the caller instantly gets a text &mdash; so the lead never slips away.", chipText: "$99/mo elsewhere", top: VIOLET })}
    </tr>
    <tr>
      ${showCard({ icon: "&#128205;", title: "Maps &amp; &ldquo;near-me&rdquo; SEO", line: "Built to be the answer on Google &amp; Apple Maps and &ldquo;near me&rdquo; searches &mdash; with tap-to-call on every page.", chipText: "$300/mo elsewhere", top: VIOLET })}
      ${showCard({ icon: "&#11088;", title: "Your reviews, live", line: (ratingNum !== null && reviewsNum !== null) ? `Your ${esc(rating)}&#9733; and ${esc(reviewsLabel)} Google reviews, pulled onto the page where they sell for you.` : "Your best reviews, pulled right onto the page where they sell for you.", chipText: "$59/mo elsewhere", top: A })}
    </tr>
    <tr>
      ${showCard({ icon: "&#128269;", title: "Rebuilt for Google &amp; AI search", line: "Every page rebuilt for Google and ChatGPT-style answers &mdash; plus your findability report, graded area by area.", chipText: "$1,000 report", top: GREEN_DEEP })}
      ${showCard({ icon: "&#128172;", title: "WSS Connect &mdash; your own app", line: "Every call, text, email &amp; DM in one inbox &mdash; a full CRM in your pocket.", chipText: "$97/mo elsewhere", dark: true })}
    </tr>
  </table>`;

  // --------------------------------------------------- THE REPORT, AS A GRAPHIC
  //
  // Owner: the report card was "not graphical enough, gets lost". Now: the
  // grade tile BIG on the left in its measured band colour, and the three
  // holding-back items as BARS — label, letter, score, fill width = the score
  // itself, fill colour = the same gradeBadgeColor band the grade tile uses.
  // A bar track is two <td>s with % widths, which renders in every client
  // Gmail included; no images, no positioning.
  //
  // Same gates as the long form, to the letter: the whole card rides
  // `roadMap` (grade AND report), bars/reasons only when the caller sourced
  // them from the report's own categories, strengths only at 90+, and the
  // road-map button opens the exact page the numbers came from. A direct
  // caller that supplied prose reasons but no bar data gets the numbered
  // sentences instead — same facts, older clothes.
  const clamp100 = (n) => Math.max(2, Math.min(100, Math.round(n)));
  // ONE ROW = THE SENTENCE + ITS BAR. The sentence is the identical reason
  // string the plain-text half prints (both halves carry the same
  // measurement, letter for letter — the parity law); the bar underneath is
  // the owner's graphic, fill width = the score itself, fill colour = the
  // same gradeBadgeColor band the grade tile uses. Bars and sentences come
  // from the same selection (gradeBarsFromCategories mirrors
  // gradeReasonsFromCategories), so pairing them by index cannot mismatch on
  // the live path; a direct caller that supplied only one of the two still
  // gets an honest card — sentences alone, or a bar row synthesised from the
  // bar's own label and score, never a blank.
  const barSentence = ({ label, grade: g, score }) => `${label} — ${g ? `${g}, ` : ""}${score}/100.`;
  const emphasiseLabel = (sentence, label) => (label && sentence.startsWith(`${label} — `)
    ? `<span style="font-weight:800">${esc(label)}</span>${esc(sentence.slice(label.length))}`
    : esc(sentence));
  const barRow = ({ label, grade: g, score, sentence }) => `
    <tr><td style="padding:7px 0 0">
      <div style="${body(13, PALETTE.ink, 600)};line-height:1.4">${emphasiseLabel(sentence, label)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:4px;border-collapse:separate"><tr>
        <td width="${clamp100(score)}%" style="width:${clamp100(score)}%;height:14px;background:${g ? gradeBadgeColor(g) : A};border-radius:7px 0 0 7px;font-size:0;line-height:0">&nbsp;</td>
        <td style="height:14px;background:${design.mix(g ? gradeBadgeColor(g) : A, "#FFFFFF", 0.84)};border-radius:0 7px 7px 0;font-size:0;line-height:0">&nbsp;</td>
      </tr></table>
    </td></tr>`;
  const holdingBack = gradeBars.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">${gradeBars.map((b, i) => barRow({ ...b, sentence: gradeReasons[i] || barSentence(b) })).join("")}</table>`
    : gradeReasons.length
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px">
          ${gradeReasons.map((r) => `<tr>
            <td width="14" valign="top" style="padding:3px 0;${body(13, A, 800)}">&#8226;</td>
            <td style="padding:3px 0;${body(13, PALETTE.ink, 600)}">${esc(r)}</td>
          </tr>`).join("")}
        </table>`
      : "";
  // THE GRADE, AS A BEFORE/AFTER REVEAL (owner pass v2, 2026-09-02: "the B-
  // grade symbol reads rough — make the grade tile cleaner/premium"). The old
  // single 84px amber tile becomes TWO tiles with the arrow between them, so
  // the card's first object is the transformation itself, not a complaint:
  //
  //   [ CURRENT SITE ]   → road map →   [ WITH OUR ROAD MAP ]
  //   ink #131318 tile,                  emerald pulse-ramp tile,
  //   thin brand-blue ring,              thin light-green ring,
  //   huge white grade,                  huge white goal grade,
  //   78/100 beneath                     (the promise, same size — an equal,
  //                                       not a bigger, claim)
  //
  // Tile = one-cell table (the gradButton law: Word engine centres what a
  // bare div cannot). Row widths 104/auto/104 so a 320px read compresses the
  // ARROW, never the tiles. Everything downstream — headline wording, bars,
  // strengths, gates — is byte-identical to the card this replaced.
  const gradeTile = (letter, { face, ring, shadowInk }) => `
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>
          <td align="center" valign="middle" width="92" height="92" bgcolor="${face}" style="width:92px;height:92px;background:${face};background-image:linear-gradient(180deg,${design.mix(face, "#FFFFFF", 0.1)} 0%,${face} 100%);border:3px solid ${ring};border-radius:20px;box-shadow:0 3px 0 ${design.mix(shadowInk, "#000000", 0.4)},0 10px 20px ${design.mix(shadowInk, "#000000", 0.3)}33;text-align:center;vertical-align:middle">
            <span style="font-family:${FONT_STACK};font-weight:900;font-size:38px;line-height:1;color:#FFFFFF;letter-spacing:-.02em">${esc(letter)}</span>
          </td>
        </tr></table>`;
  // THE REPORT, HANDED IN (v4). The measured grade is not a tile — it is a
  // paper report: a cream sheet with ruled lines, the grade written in red
  // pen and circled, a teacher's check-mark beneath. The tilt rides
  // `transform` (Outlook desktop shows it straight — the sheet survives).
  // Handwriting stack is system fonts only; no webfont.
  const HAND = "'Segoe Script','Bradley Hand','Comic Sans MS',cursive";
  const gradePaper = `
      <span style="display:inline-block;transform:rotate(-1.5deg)"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:#FDFBF3;border:1px solid #DCD3BC;border-radius:3px;box-shadow:0 10px 24px rgba(37,58,142,.18),inset 0 1px 0 #FFFFFF"><tr><td style="padding:10px 12px 12px;background:#FDFBF3;background-image:repeating-linear-gradient(180deg,rgba(222,213,188,0) 0px,rgba(222,213,188,0) 15px,#DDD6C2 15px,#DDD6C2 16px)">
        <div style="${body(7.5, PALETTE.muted, 800)};letter-spacing:.22em;text-transform:uppercase;text-align:center;padding-bottom:9px">Site report</div>
        <div style="text-align:center;padding:2px 0 10px"><span style="display:inline-block;font-family:${HAND};font-weight:700;font-size:30px;line-height:1;color:${PALETTE.danger};border:3px solid ${PALETTE.danger};border-radius:50%;padding:8px 13px;transform:rotate(-4deg)">${esc(grade)}</span></div>
        ${gradeScore !== null ? `<div style="text-align:center;font-family:${design.FONT_MONO};font-weight:700;font-size:12.5px;color:${PALETTE.ink}">${gradeScore}<span style="color:${PALETTE.muted}">/100</span></div>` : "<div style='line-height:8px;font-size:0'>&nbsp;</div>"}
        <div style="margin-top:7px;text-align:center;font-family:${HAND};font-size:13px;color:${PALETTE.danger}">&#10003; we can fix this</div>
      </td></tr></table></span>`;
  const gradeCaption = (text, color) => `<div style="margin-top:7px;text-align:center;${body(9, color, 800)};letter-spacing:.14em;text-transform:uppercase;line-height:1.5">${text}</div>`;
  const gradeReveal = goalGrade
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
      <td width="118" valign="top" align="center" style="width:118px">
        ${gradePaper}
        ${gradeCaption("Current site", PALETTE.muted)}
      </td>
      <td valign="middle" align="center" style="padding:0 4px 16px">
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>
          <td align="center" valign="middle" width="40" height="40" bgcolor="${ACCENT_WASH}" style="width:40px;height:40px;background:${ACCENT_WASH};border:1px solid ${design.mix(A, "#FFFFFF", 0.55)};border-radius:50%;text-align:center;vertical-align:middle"><span style="font-family:${FONT_STACK};font-weight:900;font-size:19px;line-height:1;color:${A}">&rarr;</span></td>
        </tr></table>
        <div style="margin-top:5px;text-align:center;${body(8, A, 800)};letter-spacing:.16em;text-transform:uppercase">Road&nbsp;map</div>
      </td>
      <td width="108" valign="top" align="center" style="width:108px">
        ${gradeTile(goalGrade, { face: GREEN_DEEP, ring: design.mix(GREEN, "#FFFFFF", 0.5), shadowInk: GREEN_DEEP })}
        ${gradeCaption("With our road&nbsp;map", GREEN_DEEP)}
      </td>
    </tr></table>`
    : (grade ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
        ${gradePaper}
        ${gradeCaption("Current site", PALETTE.muted)}
      </td></tr></table>` : "");
  const gradeGraphic = roadMap ? cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="${GLASS_CARD};border-radius:12px;border-top:3px solid ${gradeBadgeColor(grade)}">
    <tr><td style="padding:16px 18px 0">
      <div style="${body(10, gradeBadgeColor(grade), 800)};letter-spacing:.12em;text-transform:uppercase">Don't shoot the messenger</div>
      <div style="margin-top:5px;${body(17, PALETTE.ink, 800)};line-height:1.3">${
  goalGrade
    ? `We measured your site at ${grade ? `a ${esc(grade)}` : "below par"}. We have a road map to get you to ${esc(goalGrade)}.`
    : `We measured your site${grade ? ` at ${esc(grade)}` : ""} &mdash; and your road map is already written.`
}</div>
    </td></tr>
    ${grade ? `<tr><td style="padding:14px 12px 0">${gradeReveal}</td></tr>` : ""}
    <tr><td style="padding:14px 18px 18px">
        ${holdingBack ? `<div style="margin-bottom:8px;${body(10, PALETTE.muted, 800)};letter-spacing:.12em;text-transform:uppercase">What's holding you back</div>${holdingBack}` : ""}
        ${gradeStrengths.length ? `<div style="margin-top:10px">${gradeStrengths.map((s) => chip(`&#10003; ${esc(s)}`, { color: GREEN_DEEP, line: design.mix(GREEN_DEEP, "#FFFFFF", 0.7), bg: design.mix(GREEN, "#FFFFFF", 0.9) })).join("")}</div>` : ""}
        <div style="margin-top:12px;text-align:center">${gradButton({
    href: roadMap, label: "SEE YOUR ROAD MAP &nbsp;&rarr;",
    from: PALETTE.ink, to: INK_BUTTON_TO, ink: "#FFFFFF", size: 13, height: 44, radius: 12,
  })}</div>
        ${roadMap && scanned ? `<div style="margin-top:10px;${body(12, PALETTE.muted)};line-height:1.5">We checked the local competition${city ? ` around ${esc(city)}` : ""} &mdash; this report shows exactly where you stand.</div>` : ""}
    </td></tr>
  </table>`, GUTTER) : "";

  // A real Signal URL is useful even while its grade is unavailable. Keep the
  // measured card above gated on facts, and render only a neutral link here—no
  // score, diagnosis, completion claim, or fallback grade.
  const signalReportLink = report && !roadMap ? cell(`<div style="${GLASS_CARD};border-radius:12px;padding:16px 18px;text-align:center">
    ${eyebrow("SIGNAL REPORT", A)}
    <div>${gradButton({
    href: report, label: "OPEN YOUR SIGNAL REPORT &nbsp;&rarr;",
    from: PALETTE.ink, to: INK_BUTTON_TO, ink: "#FFFFFF", size: 13, height: 44, radius: 12,
  })}</div>
  </div>`, GUTTER) : "";

  // -------------------------------------------------------------- THREE DOORS
  //
  // Owner's section 5, and his exact complaint about the old one: "too
  // directive, not enough pictures — step one step two step three, these
  // people aren't bright." So: three numbered PICTURES. A row per door — a
  // number chip and a real thumbnail on the left (their new site's own phone
  // capture; the PIN, drawn big; Riley's face), the fewest words that still
  // say what the door is FOR on the right. Rows, not columns, because door 3
  // carries a phone number that must never break mid-number, and three fixed
  // columns of nowrap numbers is exactly how an email starts scrolling
  // sideways at 390.
  //
  // EVERY ROW IS GATED ON ITS OWN FACT, same as the long form: a missing
  // preview, an unprovisioned dashboard or an unset Riley line removes that
  // row and nothing else; the card itself disappears only when all three are
  // gone. ONE COUNTER, BOTH HALVES — doorNumbers is computed once and the
  // plain-text half prints the same numbers, so the two renderings cannot
  // number the same door differently.
  const doorNumbers = (() => {
    let n = 0;
    return {
      site: preview ? (n += 1) : 0,
      dashboard: dashboardDoor ? (n += 1) : 0,
      riley: riley.telHref ? (n += 1) : 0,
    };
  })();
  // POLISH MOCK 2026-09-02: same centring law as gradButton — the old
  // `margin:0 auto` div is ignored by the Word engine, which left the door
  // numbers hugging the left edge of their art column. A centred one-cell
  // table cannot be mis-centred by any client.
  const numChip = (n) => `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 auto 6px"><tr>
    <td align="center" valign="middle" width="24" height="24" bgcolor="${A}" style="width:24px;height:24px;background:${A};background-image:linear-gradient(180deg,${design.mix(A, "#FFFFFF", 0.18)} 0%,${A} 100%);border-radius:8px;border:1px solid rgba(255,255,255,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.38),0 2px 0 ${design.mix(A, "#000000", 0.3)};text-align:center;vertical-align:middle"><span style="font-family:${FONT_STACK};font-weight:900;font-size:13px;line-height:24px;color:${onAccent}">${n}</span></td>
  </tr></table>`;
  const doorLink = (href, label) => `<a href="${esc(href)}" style="font-family:${design.FONT_MONO};font-weight:700;font-size:13px;color:${A};text-decoration:none;word-break:break-all">${esc(label)}</a>`;
  const doorRow = ({ n, art, title, purpose, action, extra = "" }) => `
    <tr>
      <td width="80" valign="top" align="center" style="width:80px;padding:0 12px 12px 0">
        ${numChip(n)}
        ${art}
      </td>
      <td valign="top" style="padding:0 0 12px">
        <div style="${body(15, PALETTE.ink, 900)}">${title}</div>
        <div style="margin-top:2px;${body(12, PALETTE.muted)}">${purpose}</div>
        <div style="margin-top:6px;word-break:break-all">${action}</div>
        ${extra}
      </td>
    </tr>`;
  // Door 1's picture is the mirror's own phone capture when the record holds
  // one (the same evidence-gated URL the pair above renders), else the
  // desktop still; with neither on record the door still opens as a link.
  // afterDisplay, not afterShot: when an animated loop won the after slot the
  // static still must not reappear anywhere (one after panel, one asset —
  // test/line-email-assets pins it), so the thumbnail reuses whichever asset
  // the hero itself shipped.
  const doorSiteArt = mobileShot
    ? `<div style="background:${PALETTE.inkPanel};border:2px solid ${theirs.base};border-radius:12px;padding:3px;width:58px;margin:0 auto"><img src="${esc(mobileShot)}" width="52" height="96" alt="${esc(business) || "Your"} new site" style="display:block;width:52px;height:96px;object-fit:cover;object-position:top;border-radius:7px"></div>`
    : afterDisplay
      ? `<img src="${esc(afterDisplay)}" width="72" height="54" alt="${esc(business) || "Your"} new site" style="display:block;width:72px;height:54px;object-fit:cover;object-position:top;border:1px solid ${PALETTE.line};border-radius:8px;margin:0 auto">`
      : "";
  // Door 2's picture IS the key: the PIN drawn big enough to read across a
  // room, on the dark plate. No screenshot of a dashboard here on purpose —
  // any real dashboard render would show SOME business's data, and a
  // stranger's data in a cold email is the exact defect the thumbnail rules
  // exist to stop. The drawn plate carries the load-bearing fact instead.
  const doorPinArt = `<div style="background:${PALETTE.inkPanel};background-image:linear-gradient(180deg,${design.mix(PALETTE.inkPanel, "#FFFFFF", 0.1)} 0%,${PALETTE.inkPanel} 100%);${GLASS_DARK_FINISH};border-radius:12px;padding:9px 6px;width:62px;margin:0 auto">
        <div style="font-family:${FONT_STACK};font-weight:800;font-size:8.5px;letter-spacing:.18em;color:${A};text-transform:uppercase">Your PIN</div>
        <div style="font-family:${design.FONT_MONO};font-weight:700;font-size:16px;line-height:1.3;letter-spacing:.08em;color:#FFFFFF;margin-top:2px">${esc(dashboardPin)}</div>
      </div>`;
  const doorRileyArt = `<img src="${esc(RILEY_AVATAR_URL)}" width="60" height="60" alt="Riley, the WSS Labs AI assistant" style="display:block;border-radius:15px;margin:0 auto">`;
  const doors = [
    preview ? doorRow({
      n: doorNumbers.site,
      art: doorSiteArt,
      title: "Your new website",
      purpose: "Open it, look around, send it to anyone.",
      action: doorLink(preview, preview.replace(/^https:\/\//i, "").replace(/\/+$/, "")),
    }) : "",
    dashboardDoor ? doorRow({
      n: doorNumbers.dashboard,
      art: doorPinArt,
      title: "Your dashboard",
      // NOT "see who called and who filled in your form" — that is not true
      // today (api/preview-contact.js mails the AGENCY, and nothing writes
      // connect_threads). What IS true, and is the better sentence anyway: the
      // edit engine is live and lands or says why.
      purpose: "Ask for a change to your site in plain words, and watch it happen.",
      // ONE TAP WHEN WE HAVE A MAGIC LINK, type-it-in when we do not. The button
      // carries the signed #t= link straight into tryMagicLink(); the email+PIN
      // becomes the manual fallback beneath it so a reader who forwards the mail,
      // or whose client strips the link, can still get in.
      action: dashboardMagicLink
        ? `${gradButton({ href: dashboardMagicLink, label: "OPEN MY DASHBOARD &nbsp;&#9658;", from: A, to: ACCENT_TO, ink: onAccent, size: 15, height: 50, radius: 12, pad: 22 })}
      <div style="margin-top:5px;${body(11, PALETTE.muted, 700)}">One tap &mdash; no password to type.</div>`
        : doorLink(dashboardUrl, dashboardLabel),
      extra: dashboardMagicLink
        ? `<div style="margin-top:7px;${body(11, PALETTE.muted)}">Or sign in by hand at <span style="color:${PALETTE.ink};font-weight:700">${esc(dashboardLabel)}</span> &mdash; email <span style="color:${PALETTE.ink};font-weight:700;word-break:break-all">${esc(dashboardEmail)}</span>, PIN on the card. Same PIN every time &mdash; keep this email.</div>`
        : `<div style="margin-top:6px;${body(12, PALETTE.ink, 700)}">Sign in with your email + the PIN on the card:</div>
      <div style="margin-top:3px;font-family:${design.FONT_MONO};font-weight:700;font-size:12px;line-height:1.5;color:${PALETTE.ink};word-break:break-all">${esc(dashboardEmail)}</div>
      <div style="margin-top:4px;${body(11, PALETTE.muted)}">Same PIN every time &mdash; keep this email.</div>`,
    }) : "",
    riley.telHref ? doorRow({
      n: doorNumbers.riley,
      art: doorRileyArt,
      title: "Call Riley",
      purpose: "Say what you want changed. It is done while you are on the line. Free to call, right now &mdash; no card.",
      // TWO AFFORDANCES, NEVER ONE HYBRID (owner final-polish pass, 2026-09-03).
      // The big green button — the doors card's one green CTA, the emerald
      // money-and-motion ramp — is the WEB call: it opens talkRileyHref (the
      // VAPI web-call interface when provisioned, the live site's chat surface
      // otherwise) and NEVER dials. The phone number moves OFF the button onto
      // its own underlined 18px text link directly beneath — dialling is the
      // link's whole job. Only when no web surface exists at all does the
      // button itself carry the dial (a record with a phone and no web would
      // otherwise have no affordance here at all).
      action: talkRileyHref
        ? `${gradButton({
        href: talkRileyHref, label: "&#127908;&nbsp; CALL RILEY NOW",
        from: GREEN_DEEP, to: design.mix(GREEN, GREEN_DEEP, 0.5), ink: "#FFFFFF",
        size: 16, height: 52, radius: 12, pad: 22,
      })}
      <div style="margin-top:2px;text-align:center">${telTextLink()}</div>`
        : gradButton({
        href: riley.telHref, label: `&#9742;&nbsp; ${esc(riley.display)}`,
        from: GREEN_DEEP, to: design.mix(GREEN, GREEN_DEEP, 0.5), ink: "#FFFFFF",
        size: 18, height: 54, radius: 12, pad: 22, nowrap: true,
      }),
      extra: clientId ? `<div style="margin-top:7px;${body(12, PALETTE.muted)}">Tell him this is you: <span style="font-family:${design.FONT_MONO};font-weight:700;font-size:13px;color:${PALETTE.ink};letter-spacing:.06em">${esc(clientId)}</span></div>` : "",
    }) : "",
  ].filter(Boolean);
  const doorsBlock = doors.length ? cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="${GLASS_CARD};border-radius:12px;border-left:4px solid ${A}">
    <tr><td style="padding:16px 18px 6px">
      ${eyebrow("HOW TO GET IN", A)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">
        ${doors.join("")}
      </table>
    </td></tr>
  </table>`, GUTTER) : "";
  // Riley knows them by this ID even when no phone line is configured — the
  // one string a caller must have in hand. With the Riley door gone it would
  // otherwise appear nowhere, so it gets one small plate of its own.
  const idFallback = (!riley.telHref && clientId) ? cell(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;background:${PALETTE.inkPanel};${GLASS_DARK_FINISH};border-radius:12px">
      <tr><td align="center" style="padding:10px 16px">
        <div style="font-family:${FONT_STACK};font-weight:800;font-size:9px;letter-spacing:.2em;color:${PALETTE.inkPanelMuted};text-transform:uppercase">Your Client ID &mdash; keep this email</div>
        <div style="font-family:${design.FONT_MONO};font-weight:700;font-size:20px;line-height:1.2;letter-spacing:.1em;color:#FFFFFF;margin-top:3px;white-space:nowrap">${esc(clientId)}</div>
      </td></tr>
    </table>`, GUTTER) : "";

  // The two canon stories, two sentences, fourth-grade words. Sentence one is
  // the selection story and keeps the long form's fact-gating to the letter:
  // the city renders only when known, the count only when a caller measured
  // one, and the verb describes what the miner actually does. Sentence two is
  // the identity story, straight from docs/sales/brand-positioning.md's
  // approved claims ("American AI company" — true; the positive frame only).
  const whyYouText = marketProvisional
    ? "Why you? Your existing website fit our rebuild model, and yours is the one we chose to build."
    : `Why you? We scan local businesses${city ? ` around ${city}` : ""} that fit our rebuild model${scanned ? ` — ${scanned} of them in your area on this pass` : ""}, and yours is the one we chose to build.`;
  const whyYouHtml = marketProvisional
    ? "Why you? Your existing website fit our rebuild model, and yours is the one we chose to build."
    : `Why you? We scan local businesses${city ? ` around ${esc(city)}` : ""} that fit our rebuild model${scanned ? ` &mdash; ${esc(String(scanned))} of them in your area on this pass` : ""}, and yours is the one we chose to build.`;
  const americanAudience = marketProvisional ? "businesses" : "local businesses";
  const americanText = `WSS Labs is an American AI company: we bring the best AI made in America to ${americanAudience} like yours.`;
  // THE AMERICAN FLAG, NOW A REAL GRAPHIC (owner final-polish pass, 2026-09-03).
  // This spot carried the SECOND flag — a pure-table canton-plus-seven-stripes
  // drawing built (owner pass v2) because the 🇺🇸 emoji prints the letters "US"
  // on Windows Outlook desktop. The owner has since supplied a real first-party
  // flag raster (US_FLAG_URL, /brand/us-flag.png), so the drawn table is
  // RETIRED ENTIRELY and the <img> takes its slot: width 100% of its 63px
  // container, height auto so the 800×640 source's aspect survives any client
  // that rescales the column, explicit width/height attributes reserving the
  // box while bytes load, and alt text naming what it is. One rendering, every
  // client — no emoji, no drawn stand-in.
  const usFlagImg = ({ w = 63, h = 50 } = {}) => `<img src="${US_FLAG_URL}" width="${w}" height="${h}" alt="The flag of the United States" style="display:block;width:100%;height:auto;aspect-ratio:${w}/${h};border-radius:3px;box-shadow:0 1px 4px ${design.mix(PALETTE.ink, "#000000", 0.25)}">`;
  const storyBlock = cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${GLASS_CARD};border-radius:12px;border-left:4px solid ${A}">
    <tr><td style="padding:14px 18px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="63" valign="middle" style="width:63px;padding-right:12px">${usFlagImg({})}</td>
        <td valign="middle">
          <div style="${body(10, A, 800)};letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px">American AI</div>
          <div style="${body(14, PALETTE.ink, 800)};line-height:1.35">The best AI made in America, working for you.</div>
        </td>
      </tr></table>
      <p style="margin:8px 0 0;${body(13, PALETTE.ink, 600)};line-height:1.5">${whyYouHtml} <span style="font-weight:800;color:${A}">WSS Labs is an American AI company:</span> we bring the best AI made in America to ${americanAudience} like yours.</p>
    </td></tr>
  </table>`, GUTTER);

  // The header chip: their name, in their measured colour, beside our mark —
  // both brands visible from the first pixel. Allowed to wrap; never nowrap.
  const nameChip = business ? `<span style="display:inline-block;background:${theirs.tint};border:1px solid ${theirs.tintLine};border-radius:999px;padding:5px 12px;font-family:${FONT_STACK};font-weight:800;font-size:11px;letter-spacing:.04em;color:${theirs.onLight};text-transform:uppercase">${esc(business)}</span>` : "";

  // ------------------------------------------------------------- THE TRUST BAND
  //
  // Row one is the owner's literal ask: a gold star emblem beside
  // "4.9 &middot; 1,212 Google Reviews", high in the email — as many stars FILLED
  // as the rating actually is (goldStars' law, 2026-08-16: never five gold for a
  // 3.0 again). Row two carries the
  // credentials we actually hold as pills — years, licensed, insured — and is
  // omitted whole when we hold none, so the band collapses to exactly the
  // emblem-plus-count he named. Dark panel, gold stars: the one warm accent in a
  // cool brand, reserved for this. Gated on BOTH numbers, because a star with no
  // count (or a count with no star) is a trust claim a reader cannot weigh.
  const STAR_GOLD = "#F59E0B"; // MOSAIC V2: gold reserved for the rating stars ONLY (owner-approved)
  // THE STARS PRINT THE NUMBER WE WERE GIVEN, OR THEY DO NOT PRINT (2026-08-16,
  // after the Ron Steele sandbox send). That proof shipped "★★★★★" beside
  // "3 · 14 Google reviews" — a 3.0 rendered as five gold stars — because the
  // hollow remainder was dimmed with `opacity:.32`, and the client that opened
  // it ignored inline opacity on the nested span (Outlook's Word engine does;
  // several webmail sanitizers do too), painting all five at full gold. Two
  // laws close it:
  //   * A star block is a numeric claim about a real business's rating, so a
  //     NON-NUMERIC value renders NOTHING — absent field removes the block,
  //     never five dim placeholders standing in for a number nobody measured.
  //   * The remainder is drawn in a COLOUR MIXED toward the panel it sits on
  //     (the same design.mix idiom this file dims everything else with), which
  //     every client renders identically because it is only a colour — no
  //     opacity anywhere. `dim` names that panel: the navy trust band and hero
  //     take the default; the quote card passes its white one.
  const goldStars = (value, { color = STAR_GOLD, dim = "", size = 18 } = {}) => {
    const rating = numOrNull(value);
    if (rating === null) return "";
    const full = Math.max(0, Math.min(5, Math.round(rating)));
    const hollow = dim || design.mix(color, PALETTE.inkPanel, 0.78);
    return `<span style="color:${color};font-size:${size}px;letter-spacing:2px;line-height:1;white-space:nowrap">${"&#9733;".repeat(full)}<span style="color:${hollow}">${"&#9733;".repeat(5 - full)}</span></span>`;
  };
  const credentialText = [
    yearsInBusiness ? `${yearsInBusiness}+ years in business` : "",
    licensed && insured ? "Licensed &amp; insured" : licensed ? "Licensed" : insured ? "Insured" : "",
  ].filter(Boolean);
  // The plain-text twin of the credential pills — same facts, no entity. Written
  // here so the two MIME halves cannot drift into naming different credentials.
  const credentialTextPlain = [
    yearsInBusiness ? `${yearsInBusiness}+ years in business` : "",
    licensed && insured ? "Licensed & insured" : licensed ? "Licensed" : insured ? "Insured" : "",
  ].filter(Boolean).join(" · ");
  // THE THIN-TARGET PITCH LINE (issue #689, owner doctrine: thin/un-integrated
  // sites are the BEST converts). A SELECTABLE line, not a template constant:
  // it renders ONLY when the caller passed the mine-measured reviews-gap flag
  // (options.integrationGap === true, fact-gated by lib/proof-email-inputs off
  // record.integration_gap) AND the prospect's own verified review numbers are
  // in hand — "your Google reviews" is a claim about reviews we can count.
  // Truth law, both halves of the sentence:
  //   * "never showed on your old site" — measured at 2_homepage_fetch: no
  //     review widget and no review/testimonial content on the fetched
  //     homepage. A site the mine saw showing its reviews never gets this line.
  //   * "front and center on the new one" — true by construction: the engine
  //     wires the verified GBP review rail into the mirror, and this gate
  //     requires at least one review to render (reviewsNum > 0).
  // Absent flag or absent numbers removes the line entirely, never a
  // placeholder — the same absent-removes-the-block rule as every field here.
  const thinTargetReviewsLinePlain = (o.integrationGap === true && ratingNum !== null && reviewsNum !== null && reviewsNum > 0)
    ? "Your Google reviews never showed on your old site — they're front and center on the new one."
    : "";
  const thinTargetReviewsLineHtml = thinTargetReviewsLinePlain
    ? "Your Google reviews never showed on your old site &mdash; they're front and center on the new one."
    : "";
  const trustBand = (ratingNum !== null && reviewsNum !== null) ? cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.inkPanel};background-image:linear-gradient(165deg,${design.mix(PALETTE.inkPanel, VIOLET, 0.22)} 0%,${PALETTE.inkPanel} 46%,${design.mix(PALETTE.inkPanel, A, 0.16)} 100%);${GLASS_DARK_FINISH};border-radius:12px">
    <tr><td style="padding:16px 18px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="padding-right:10px">${goldStars(ratingNum, { size: 20 })}</td>
        <td valign="middle" style="padding-right:8px;font-family:${FONT_STACK};font-weight:900;font-size:24px;line-height:1;color:#FFFFFF;letter-spacing:-.01em">${esc(rating)}</td>
        <td valign="middle" style="${body(13, PALETTE.inkPanelMuted, 700)}">&middot;&nbsp; ${esc(reviewsLabel)} Google reviews</td>
      </tr></table>
      ${credentialText.length ? `<div style="margin-top:9px">${credentialText.map((c) => `<span style="display:inline-block;background:${design.mix(PALETTE.inkPanel, "#FFFFFF", 0.1)};border:1px solid ${PALETTE.inkPanelLine};border-radius:999px;padding:4px 10px;margin:6px 6px 0 0;font-family:${FONT_STACK};font-size:11px;font-weight:700;color:${PALETTE.inkPanelInk}">&#10003;&nbsp; ${c}</span>`).join("")}</div>` : ""}
      ${thinTargetReviewsLineHtml ? `<div style="margin-top:9px;${body(12.5, PALETTE.inkPanelInk, 600)};line-height:1.45">${thinTargetReviewsLineHtml}</div>` : ""}
    </td></tr>
  </table>`, GUTTER) : "";

  // ------------------------------------------------------ WHAT THEY ALREADY SAY
  //
  // The same two Google reviews the owner already sees on the mirror, brought
  // into the email: a REAL reviewer face when Google served one (the caller has
  // already run isGoogleReviewerFace), a monogram of the reviewer's initial when
  // it did not — never a broken image, never a stock face. Light card under the
  // dark band, so the band and the quotes read as one trust cluster high up.
  const monogram = (author) => {
    const ch = String(author || "").trim().charAt(0).toUpperCase();
    return `<div style="width:38px;height:38px;border-radius:50%;background:${theirs.tint};border:1px solid ${theirs.tintLine};text-align:center"><span style="font-family:${FONT_STACK};font-weight:800;font-size:16px;line-height:38px;color:${theirs.onLight}">${ch ? esc(ch) : "&#10077;"}</span></div>`;
  };
  // Trim to one line and strip a dangling separator before the ellipsis, so a
  // cut quote never ends "great service," with a hanging comma.
  const quoteText = (t) => {
    const str = String(t || "").replace(/\s+/g, " ").trim();
    return esc(str.length > 116 ? `${str.slice(0, 114).replace(/[\s,.;:!?-]+$/, "")}…` : str);
  };
  // The plain-text twin: same quote, a touch more room (no card to fit), still
  // one line so a text client shows the same proof the HTML card does.
  const quoteTextPlain = (t) => {
    const str = String(t || "").replace(/\s+/g, " ").trim();
    return str.length > 180 ? `${str.slice(0, 178).replace(/[\s,.;:!?-]+$/, "")}…` : str;
  };
  const quoteRow = (q) => `<tr>
        <td width="46" valign="top" style="width:46px;padding:0 10px 11px 0">
          ${q.faceUrl
    ? `<img src="${esc(q.faceUrl)}" width="38" height="38" alt="${esc(q.author) || "Reviewer"}, on Google" style="display:block;width:38px;height:38px;border-radius:50%;object-fit:cover;border:1px solid ${theirs.tintLine}">`
    : monogram(q.author)}
        </td>
        <td valign="top" style="padding:0 0 11px">
          ${q.rating !== null ? `<div style="margin-bottom:3px">${goldStars(q.rating, { color: STAR_GOLD, dim: design.mix(STAR_GOLD, PALETTE.panel, 0.78), size: 13 })}</div>` : ""}
          <div style="${body(13, PALETTE.ink, 500)};line-height:1.45">&ldquo;${quoteText(q.text)}&rdquo;</div>
          ${q.author ? `<div style="margin-top:3px;${body(11, PALETTE.muted, 700)}">&mdash; ${esc(q.author)}, on Google</div>` : ""}
        </td>
      </tr>`;
  const quoteCard = reviewQuotes.length ? cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${GLASS_CARD};border-radius:12px;border-left:4px solid ${theirs.base}">
    <tr><td style="padding:16px 18px 5px">
      ${eyebrow("WHAT YOUR CUSTOMERS ALREADY SAY", theirs.onLight)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">${reviewQuotes.map(quoteRow).join("")}</table>
    </td></tr>
  </table>`, GUTTER) : "";

  // ----------------------------------------------------- BUILT WITH AMERICAN AI
  //
  // The umbrella line from docs/sales/brand-positioning.md, placed in the VALUE
  // section (owner: "place it in the value section, not as a bolt-on"). TEXT
  // treatment in the WSS brand type — NO third-party logos, because the models'
  // brand policies are unverified and text is the honest, safe form. The four
  // names are the one accent; the dark strip matches the "what you get" tiles it
  // sits under. This is a claim about our own stack, always true — no gate.
  const AMERICAN_MODELS_LINE = "We use every leading American AI model — Claude, GPT, Gemini, Perplexity — across everything we do for your business. The platform runs on Anthropic's Mythos and Fable 5 series frontier models — keeping the competitive edge over everybody else, foreign and domestic.";
  const modelAccent = design.mix(A, "#FFFFFF", 0.42);
  const modelName = (n) => `<span style="color:${modelAccent};font-weight:900">${n}</span>`;
  const americanModelsBlock = cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.inkPanel};background-image:linear-gradient(165deg,${design.mix(PALETTE.inkPanel, VIOLET, 0.22)} 0%,${PALETTE.inkPanel} 46%,${design.mix(PALETTE.inkPanel, A, 0.16)} 100%);${GLASS_DARK_FINISH};border-left:4px solid ${A};border-radius:12px">
    <tr><td style="padding:14px 18px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="63" valign="middle" style="width:63px;padding-right:12px">${usFlagImg({})}</td>
        <td valign="middle">${eyebrow("BUILT WITH AMERICAN AI", modelAccent)}</td>
      </tr></table>
      <div style="${body(13, "#FFFFFF", 700)};line-height:1.5">We use every leading American AI model &mdash; ${modelName("Claude")}, ${modelName("GPT")}, ${modelName("Gemini")}, ${modelName("Perplexity")} &mdash; across everything we do for your business.</div>
      <div style="margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.14);${body(12.5, PALETTE.inkPanelInk, 600)};line-height:1.55">The platform runs on ${modelName("Anthropic's Mythos")} and ${modelName("Fable 5")} series frontier models &mdash; <span style="color:#FFFFFF;font-weight:800">keeping the competitive edge over everybody else, foreign and domestic.</span></div>
    </td></tr>
  </table>`, GUTTER);

  // ═══════════════════════════════════════════════════════════════════════════
  // MOSAIC V2 BLOCKS. Everything below is the owner-approved v2 layout, in blue.
  // Each block keeps the composer's absent-removes-it law and adds NO <img>
  // (the email's image inventory is pinned), so the re-skin is additive.
  // ═══════════════════════════════════════════════════════════════════════════

  // talkRileyHref and telTextLink are defined up with talkToRileyUrl (above
  // the palette), because the doors array below consumes them.

  // 2 · HERO (navy). Carries every pinned step-1 marker.
  const heroRating = (ratingNum !== null && reviewsNum !== null) ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px"><tr>
          <td valign="middle" style="padding-right:9px">${goldStars(ratingNum, { size: 15 })}</td>
          <td valign="middle" style="${body(15, "#FFFFFF", 700)};padding-right:7px">${esc(rating)}</td>
          <td valign="middle" style="${body(13, PALETTE.inkPanelMuted)}">&middot;&nbsp; ${esc(reviewsLabel)} Google reviews</td>
        </tr></table>` : "";
  const heroNavy = `<tr><td style="padding:0 6px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PALETTE.inkPanel};background-image:linear-gradient(160deg,${design.mix(PALETTE.inkPanel, A, 0.30)} 0%,${PALETTE.inkPanel} 46%,${design.mix(PALETTE.inkPanel, VIOLET, 0.30)} 100%);border:1px solid ${PALETTE.inkPanelLine};border-top:3px solid ${A};border-radius:16px">
      <tr><td style="padding:26px 24px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${design.mix(PALETTE.inkPanel, "#FFFFFF", 0.08)}" style="background:${design.mix(PALETTE.inkPanel, "#FFFFFF", 0.08)};border:1px solid ${design.mix(A, PALETTE.inkPanel, 0.45)};border-radius:999px;padding:6px 13px;font-family:${FONT_STACK};font-size:10px;font-weight:800;letter-spacing:.16em;color:${ACCENT_LIGHT}">&#9670;&nbsp; YOU WERE PICKED</td></tr></table>
        <h1 style="margin:11px 0 0;font-family:${FONT_STACK};font-weight:900;font-size:30px;line-height:1.16;letter-spacing:-.025em;color:#FFFFFF">${business ? `${esc(business)},<br><span style="color:${ACCENT_LIGHT}">we already built your new website.</span>` : `<span style="color:${ACCENT_LIGHT}">We already built your new website.</span>`}</h1>
        <p style="margin:11px 0 0;${body(15, PALETTE.inkPanelInk)};line-height:1.55">It is live right now. You pay nothing to look at it.</p>
        ${heroRating}
        ${preview ? `<div style="margin-top:20px;text-align:center">${gradButton({ href: preview, label: "OPEN YOUR LIVE PREVIEW &nbsp;&rarr;", from: A, to: ACCENT_TO, ink: onAccent, size: 17, height: 56, pad: 0, full: true, sweep: true })}</div>
        <div style="margin-top:10px;text-align:center;${body(12, PALETTE.inkPanelMuted)}">Nothing to install. Takes 5 seconds.</div>` : `<div style="margin-top:14px;${body(12, PALETTE.inkPanelMuted)}">Nothing to install. Takes 5 seconds.</div>`}
      </td></tr>
    </table>
  </td></tr>`;

  // 4 · YOUR FREE BACKEND IS READY. Big PIN + sign-in + top doors. Gated on the
  // SAME dashboardDoor as the how-to-get-in door, so the PIN is only ever shown
  // when the row behind it was really provisioned. No <img>.
  // SHARPNESS PASS: this card loses its border-left (the quote card above and
  // the doors below keep theirs — three left-barred cards in a row was part of
  // the "everything too similar" read) and gains ONE primary action: the
  // dashboard button, full width and taller. Talk-to-Riley stays, demoted to
  // the quiet link the section's second action should be.
  // THE BUTTON LEADS, THE PIN FOLLOWS (design pass 2026-08-19). The magic
  // link IS the product — one tap and the reader is inside — so the big
  // gradient button now sits directly under the copy, and the PIN plate is
  // demoted to the compact fallback it really is: same words, same PIN, same
  // sign-in line, a third of the ink. The 44px/12-tracking numeral drawn
  // above the button was the loudest object in the section and made the
  // fallback read as the door.
  //
  // THE CARD ALWAYS RENDERS (2026-09-03). Until now `!dashboardDoor` blanked
  // this whole slot — a dry run, an unconfigured store or a failed access-row
  // write arrived as EMPTY SPACE where a dashboard card sits on every
  // provisioned send. The card now renders in BOTH states: provisioned keeps
  // the sign-in card below untouched, and unprovisioned becomes a CLAIM-PATH
  // CTA ("Your customer dashboard is ready to claim") in the same gradButton
  // language the email's other actions speak. TRUTH LAW, both directions: the
  // claim card never says the dashboard is live, switched on, or sign-in-able
  // (no PIN, no sign-in address, no "already switched on" — an unprovisioned
  // row cannot be logged into), and it never points at a URL that 401s: the
  // button exists only when checkoutUrl does, exactly like the price card's
  // own START MY PLAN button.
  const freeBackendClaim = cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${GLASS_CARD};border-radius:12px;border-top:3px solid ${A}">
    <tr><td style="padding:18px 18px 18px">
      ${eyebrow("&#9670;&nbsp; YOUR CUSTOMER DASHBOARD IS READY TO CLAIM", A)}
      <div style="${body(17, PALETTE.ink, 800)};line-height:1.3">A whole back office for your business.</div>
      <div style="margin-top:7px;${body(15, PALETTE.ink, 700)};line-height:1.45">Watch every lead arrive live &mdash; and call Riley to change anything.</div>
      <div style="margin-top:5px;${body(13, PALETTE.muted)};line-height:1.5">Your dashboard runs the site in plain words: ask for a change and watch it happen, and get a text the second a call comes in. It comes with your plan &mdash; claim it when you start.</div>
      ${checkoutUrl ? `<div style="margin-top:16px;text-align:center">${gradButton({ href: checkoutUrl, label: "CLAIM YOUR DASHBOARD &nbsp;&rarr;", from: A, to: ACCENT_TO, ink: onAccent, size: 17, height: 56, radius: 12, pad: 0, full: true })}</div>
      <div style="margin-top:8px;text-align:center;${body(11, PALETTE.muted)}">Secure checkout. Cancel any time, from the first month.</div>` : ""}
      ${!checkoutUrl && riley.telHref ? `<div style="margin-top:12px;text-align:center;${body(12, PALETTE.muted)}">To claim it sooner, call Riley &mdash; free, right now, no card: <strong style="color:${PALETTE.ink};font-weight:800;white-space:nowrap">${esc(riley.display)}</strong></div>` : ""}
    </td></tr>
  </table>`, GUTTER);
  const freeBackend = dashboardDoor ? cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${GLASS_CARD};border-radius:12px;border-top:3px solid ${A}">
    <tr><td style="padding:18px 18px 18px">
      ${eyebrow("&#9670;&nbsp; YOUR FREE BACKEND IS READY", A)}
      <div style="${body(17, PALETTE.ink, 800)};line-height:1.3">A whole back office &mdash; already switched on for you.</div>
      <div style="margin-top:7px;${body(15, PALETTE.ink, 700)};line-height:1.45">Watch every lead arrive live &mdash; and call Riley to change anything.</div>
      <div style="margin-top:5px;${body(13, PALETTE.muted)};line-height:1.5">Your dashboard runs the site in plain words: ask for a change and watch it happen, and get a text the second a call comes in. Sign in with your email and this PIN.</div>
      <div style="margin-top:16px;text-align:center">${gradButton({ href: dashboardMagicLink || dashboardUrl, label: "OPEN YOUR DASHBOARD &nbsp;&rarr;", from: A, to: ACCENT_TO, ink: onAccent, size: 17, height: 56, radius: 12, pad: 0, full: true })}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:12px"><tr>
        <td align="center" style="background:${PALETTE.subtle};border:1px dashed ${design.mix(A, "#FFFFFF", 0.5)};border-radius:12px;padding:10px 12px 11px">
          <div style="${body(10, PALETTE.muted, 800)};letter-spacing:.16em;text-transform:uppercase">Dashboard PIN &nbsp;<span style="font-family:${design.FONT_MONO};font-weight:700;font-size:16px;letter-spacing:4px;color:${PALETTE.ink}">${esc(dashboardPin)}</span></div>
          <div style="margin-top:6px;${body(12, PALETTE.muted)};line-height:1.5">Sign in at <a href="${esc(dashboardUrl)}" style="color:${A};font-weight:700;text-decoration:none">${esc(dashboardLabel)}</a> with <span style="font-family:${design.FONT_MONO};color:${PALETTE.ink}">${esc(dashboardEmail)}</span>${clientId ? ` &middot; Client&nbsp;ID <strong style="color:${PALETTE.ink}">${esc(clientId)}</strong>` : ""}</div>
        </td>
      </tr></table>
      ${talkRileyHref ? `<div style="margin-top:6px;text-align:center"><a href="${esc(talkRileyHref)}" style="display:inline-block;padding:12px 10px;font-family:${FONT_STACK};font-weight:800;font-size:14px;letter-spacing:.02em;color:${GREEN_DEEP};text-decoration:none">&#127908;&nbsp; TALK TO RILEY NOW</a></div>` : ""}
    </td></tr>
  </table>`, GUTTER) : freeBackendClaim;

  // 5 · WSS CONNECT banner — navy panel with the owner's own funnel graphic
  // (CONNECT_FUNNEL_URL) on a WHITE card so its transparent background and dark
  // "WSS Connect" label read correctly (the emoji recreation this replaced was
  // the owner's ask — "I like my original graphic"). A solid navy sits under the
  // gradient for clients that drop it; the one added <img> is first-party and the
  // pinned image counts are bumped to match.
  // DESIGN PASS 2026-08-19: this was the one card with no border, its own
  // radius (14) and its own gradient angle (135deg to a much brighter blue),
  // so the jump from the white card above read as a different email. It now
  // speaks the hero's exact gradient language (160deg, same mix, settling to
  // the same navy), wears the same hairline and 12px radius as every other
  // dark card, and takes the statement padding the hero and price card share.
  // 5 · WSS CONNECT banner — navy panel carrying THE APP-FRAME GRAPHIC (owner
  // pass v2, the showpiece: "rebuild it as a refined device/app-frame graphic…
  // zero placeholder letters"). The old connect-funnel.png (six letter tiles
  // into a W) is retired. The frame is drawn entirely from tables + inline
  // styles so it renders in Gmail AND Outlook desktop with no data-URI and no
  // sanitizer risk:
  //
  //   · a white phone card — earpiece slot, app bar, home-bar — the device read;
  //   · the app bar leads with the REAL first-party W mark (wss-mark-176.png,
  //     already in this email's pinned inventory, so the image count is
  //     unchanged), the wordmark, and a green LIVE pill;
  //   · the four channels the owner named as REAL BRAND-COLOURED BADGES, not
  //     letters-as-logos: Google's white G, Facebook's f, Instagram's gradient
  //     camera (drawn), Yelp's red burst — each a one-cell table with the
  //     platform's own recognisable colour (the same no-traced-artwork law
  //     lib/wss-connect-assets/funnel-html.js has always followed: our own
  //     drawing, their hue);
  //   · a green funnel chevron into a LIVE INBOX PLATE — three rows, one per
  //     channel, each closed by a green answered pill — the "one inbox" claim,
  //     shown instead of said.
  //
  // Claims stay inside what the product does today: the plate says the same
  // three facts the surrounding copy has always carried (messages answered,
  // missed call texted back) — nothing new is promised by the drawing.
  const appBadge = ({ label, bg, border = "", glyph = "", inner = "", gradient = "" }) => `
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>
          <td align="center" valign="middle" width="46" height="46" bgcolor="${bg}" style="width:46px;height:46px;background:${bg};${gradient}border-radius:12px;${border ? `border:1px solid ${border};` : ""}box-shadow:0 2px 0 ${design.mix(bg, "#000000", 0.25)};text-align:center;vertical-align:middle">${glyph}${inner}</td>
        </tr></table>
        <div style="margin-top:5px;text-align:center;${body(8, PALETTE.muted, 800)};letter-spacing:.1em;text-transform:uppercase">${label}</div>`;
  const igCamera = `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>
            <td align="center" valign="middle" width="21" height="21" style="border:2.5px solid #FFFFFF;border-radius:7px;font-size:0;line-height:0"><div style="width:7px;height:7px;background:#FFFFFF;border-radius:50%;font-size:0;line-height:0">&nbsp;</div></td>
          </tr></table>`;
  const inboxRow = (dotColor, text, tag) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:6px"><tr>
            <td width="10" valign="middle" style="width:10px"><div style="width:8px;height:8px;background:${dotColor};border-radius:50%;font-size:0;line-height:0">&nbsp;</div></td>
            <td valign="middle" style="padding:0 8px;${body(11.5, PALETTE.ink, 600)};line-height:1.35">${text}</td>
            <td align="right" valign="middle"><span style="display:inline-block;${TAG_BG};border-radius:999px;padding:3px 9px;font-family:${FONT_STACK};font-size:8.5px;font-weight:800;letter-spacing:.08em;color:#FFFFFF;text-transform:uppercase;white-space:nowrap">${tag}</span></td>
          </tr></table>`;
  const wssConnect = cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.inkPanel};background-image:linear-gradient(160deg,${design.mix(PALETTE.inkPanel, A, 0.30)} 0%,${PALETTE.inkPanel} 46%,${design.mix(PALETTE.inkPanel, VIOLET, 0.30)} 100%);${GLASS_DARK_FINISH};border-top:3px solid ${A};border-radius:12px">
    <tr><td style="padding:26px 24px">
      <div style="${body(11, ACCENT_LIGHT, 800)};letter-spacing:.16em;text-transform:uppercase">WSS Connect</div>
      <div style="margin-top:8px;font-family:${FONT_STACK};font-weight:800;font-size:30px;line-height:1.08;letter-spacing:-.02em;color:#FFFFFF">Every Lead.<br>One Inbox.</div>
      <div style="margin-top:10px;${body(15, PALETTE.inkPanelInk)};line-height:1.5">SMS, email, calls &amp; social DMs &mdash; unified in one app on your phone.</div>
      <div style="margin-top:16px;background:#FFFFFF;border:1px solid ${PALETTE.line};border-radius:18px;padding:12px 14px 14px;box-shadow:0 12px 28px ${design.mix(PALETTE.inkPanel, "#000000", 0.35)}4D">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
          <td>
            <div style="width:44px;height:5px;background:${PALETTE.line};border-radius:999px;margin:0 auto 10px;font-size:0;line-height:0">&nbsp;</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
              <td width="30" valign="middle" style="width:30px;padding-right:9px"><img src="${esc(WSS_MARK_URL)}" width="28" height="28" alt="WSS Connect" style="display:block;width:28px;height:28px;border-radius:8px"></td>
              <td valign="middle">
                <div style="font-family:${FONT_STACK};font-weight:800;font-size:13.5px;line-height:1.2;color:${PALETTE.ink}">WSS Connect</div>
                <div style="font-family:${FONT_STACK};font-size:9px;font-weight:700;letter-spacing:.08em;color:${PALETTE.muted};padding-top:1px">Every channel &middot; one inbox</div>
              </td>
              <td align="right" valign="middle"><span style="display:inline-block;${TAG_BG};border-radius:999px;padding:3px 9px;font-family:${FONT_STACK};font-size:8.5px;font-weight:800;letter-spacing:.12em;color:#FFFFFF;text-transform:uppercase">Live</span></td>
            </tr></table>
          </td>
        </tr></table>
        <div style="height:1px;background:${PALETTE.line};font-size:0;line-height:0;margin:11px 0 12px">&nbsp;</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed"><tr>
          <td width="25%" align="center" valign="top" style="width:25%;padding:0 2px">${appBadge({ label: "Google", bg: "#FFFFFF", border: PALETTE.line, glyph: `<span style="font-family:${FONT_STACK};font-weight:900;font-size:23px;line-height:1;color:#4285F4">G</span>` })}</td>
          <td width="25%" align="center" valign="top" style="width:25%;padding:0 2px">${appBadge({ label: "Facebook", bg: "#1877F2", glyph: `<span style="font-family:${FONT_STACK};font-weight:900;font-size:26px;line-height:1;color:#FFFFFF">f</span>` })}</td>
          <td width="25%" align="center" valign="top" style="width:25%;padding:0 2px">${appBadge({ label: "Instagram", bg: "#DD2A7B", gradient: `background-image:linear-gradient(135deg,#F58529 0%,#DD2A7B 45%,#8134AF 75%,#515BD4 100%);`, inner: igCamera })}</td>
          <td width="25%" align="center" valign="top" style="width:25%;padding:0 2px">${appBadge({ label: "Yelp", bg: "#D32323", glyph: `<span style="font-family:${FONT_STACK};font-weight:900;font-size:21px;line-height:1;color:#FFFFFF">&#10033;</span>` })}</td>
        </tr></table>
        <div style="margin:12px 0 10px;text-align:center"><span style="display:inline-block;background:${design.mix(GREEN, "#FFFFFF", 0.85)};border-radius:999px;padding:2px 10px;font-family:${FONT_STACK};font-weight:900;font-size:12px;line-height:1.5;color:${GREEN_DEEP}">&darr;</span></div>
        <div style="background:${PALETTE.subtle};border:1px solid ${PALETTE.line};border-radius:12px;padding:10px 12px 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
            <td style="${body(8.5, PALETTE.muted, 800)};letter-spacing:.14em;text-transform:uppercase">Your inbox &mdash; today</td>
            <td align="right" style="${body(8.5, GREEN_DEEP, 800)};letter-spacing:.1em;text-transform:uppercase">All answered</td>
          </tr></table>
          ${inboxRow("#4285F4", "Google message &mdash; answered in the app", "&#10003; Done")}
          ${inboxRow("#1877F2", "Facebook DM &mdash; answered in the app", "&#10003; Done")}
          ${inboxRow(GREEN, "Missed call &mdash; text back sent for you", "&#10003; Auto")}
        </div>
        <div style="width:56px;height:4px;background:${PALETTE.line};border-radius:999px;margin:12px auto 0;font-size:0;line-height:0">&nbsp;</div>
      </div>
      <div style="margin-top:14px;${body(13, PALETTE.inkPanelInk)};line-height:1.5">Miss a call and it texts back for you &mdash; automatically. Every channel your customers use, answered from one place.</div>
    </td></tr>
  </table>`, GUTTER);

  // 8 · MEET RILEY. Carries the pinned "Meet Riley" / "Your own web developer,
  // on the phone." markers, the avatar (Riley renders exactly twice in the whole
  // email — here and the call-Riley door — per the pinned image inventory), the
  // Talk-to-Riley (web) + tel buttons, and the Client ID. Gated on the tel line.
  // GATED ON preview OR the tel line (not the tel line alone): this section
  // replaced the always-present "Meet Riley" tile, and the whole email's image
  // set is pinned (test/email-truth-packet-adapter counts wss-mark + before +
  // after x2 + Riley). Dropping the avatar whenever no phone is configured took
  // that count from 5 to 4 (test/email-recipient-safety). Riley's face now shows
  // whenever the email does; the tel button appears only with a real line; the
  // primary button uses talkRileyHref, which is non-empty here (preview -> #chat).
  // HONESTY PASS 2026-09-02: Riley is HE/HIM everywhere he speaks (owner
  // correction; the card said "Tell her"), and the channel line is voice-only —
  // the same VAPI no-SMS fact the truth pass above applied to the bullets —
  // so "you text or call" narrowed to "you call".
  // POLISH V2 — THE RILEY CARD, HERO-ADJACENT (owner: "the phone/microphone
  // indicators read small — make the Riley CTA a proper hero-adjacent card").
  // Avatar up to 58px in an accent ring, a green CALL-ANY-TIME pill (the
  // always-on fact, shown not said), the 🎙️ button one step bigger, and the
  // phone number promoted from a 13px mono footnote to an 18px bold green
  // tap-to-call pill — the second scannable phone CTA in the email.
  // THE ROBOT-DEVELOPER BADGE (v4, the owner's graphic ask): an AI robot-man
  // — half robot, half human web developer, glasses on, WSS-brand panels,
  // friendly. Image generation was checked FIRST (OpenRouter, the seedance
  // lane's own provider): the provider path is chat-completions text only and
  // both OPENROUTER_API_KEY values in the env chain are dead (one empty, one
  // 401 "User not found"), so per the brief this is the fallback: the best
  // possible TABLE-DRAWN badge — pure cells, no images, renders identically
  // in Gmail and Outlook desktop. Left half: the machine (steel panel, glowing
  // brand-blue lens, speaker grille). Right half: the human (skin, eye, smile,
  // hair). Shared glasses bar. WSS-green antenna, navy-glass chassis.
  const rileyRobot = () => `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 auto">
            <tr><td height="9" align="center" style="height:9px;font-size:0;line-height:0"><div style="width:8px;height:8px;background:${GREEN};border-radius:50%;box-shadow:0 0 9px ${GREEN};font-size:0;line-height:0">&nbsp;</div></td></tr>
            <tr><td align="center" style="padding:2px 0 0">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:${PALETTE.inkPanel};background-image:linear-gradient(160deg,${design.mix(PALETTE.inkPanel, A, 0.35)} 0%,${PALETTE.inkPanel} 60%,${design.mix(PALETTE.inkPanel, VIOLET, 0.3)} 100%);border:2px solid #2C3E66;border-radius:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 10px 22px rgba(15,25,60,.30)"><tr>
                <td style="padding:5px">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;table-layout:fixed">
                    <tr>
                      <td width="32" height="6" bgcolor="#C3CFE6" style="width:32px;height:6px;background:#C3CFE6;border-radius:6px 0 0 0;font-size:0;line-height:0">&nbsp;</td>
                      <td width="4" style="width:4px;background:#223055;font-size:0;line-height:0">&nbsp;</td>
                      <td width="32" height="6" bgcolor="#4A3728" style="width:32px;height:6px;background:#4A3728;border-radius:0 6px 0 0;font-size:0;line-height:0">&nbsp;</td>
                    </tr>
                    <tr>
                      <td align="center" bgcolor="#D9E2F2" style="background:#D9E2F2;padding:5px 0"><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td width="18" height="11" align="center" valign="middle" bgcolor="${A}" style="width:18px;height:11px;background:${A};border-radius:3px;box-shadow:0 0 9px ${A};font-size:0;line-height:0"><div style="width:5px;height:3px;background:#FFFFFF;border-radius:2px;margin:0 auto;font-size:0;line-height:0">&nbsp;</div></td></tr></table></td>
                      <td width="4" bgcolor="#223055" style="width:4px;background:#223055;font-size:0;line-height:0">&nbsp;</td>
                      <td align="center" bgcolor="#F2C9A0" style="background:#F2C9A0;padding:5px 0"><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td width="18" height="11" align="center" valign="middle" bgcolor="#FFFFFF" style="width:18px;height:11px;background:#FFFFFF;border:2px solid #223055;border-radius:4px;font-size:0;line-height:0"><div style="width:4px;height:4px;background:#223055;border-radius:50%;margin:0 auto;font-size:0;line-height:0">&nbsp;</div></td></tr></table></td>
                    </tr>
                    <tr>
                      <td align="center" bgcolor="#C7D2E8" style="background:#C7D2E8;padding:4px 0"><span style="font-family:${FONT_STACK};font-weight:900;font-size:8px;letter-spacing:2px;color:#5A6B94">&#183;&#183;&#183;</span></td>
                      <td bgcolor="#223055" style="background:#223055;font-size:0;line-height:0">&nbsp;</td>
                      <td align="center" bgcolor="#F2C9A0" style="background:#F2C9A0;padding:4px 0"><div style="width:14px;height:3px;background:#B06A3B;border-radius:2px;margin:0 auto;font-size:0;line-height:0">&nbsp;</div></td>
                    </tr>
                  </table>
                </td>
              </tr></table>
            </td></tr>
            <tr><td align="center" style="padding:0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;width:78px;background:${PALETTE.inkPanel};background-image:linear-gradient(180deg,#33456F 0%,${PALETTE.inkPanel} 100%);border-radius:0 0 9px 9px;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)"><tr><td height="14" align="center" valign="middle" style="height:14px;font-size:0;line-height:0"><div style="width:6px;height:6px;background:${GREEN};border-radius:50%;font-size:0;line-height:0">&nbsp;</div></td></tr></table></td></tr>
          </table>`;
  const meetRiley = (preview || riley.telHref) ? cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${GLASS_CARD};border-radius:12px">
    <tr><td style="padding:16px 18px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
        <td width="58" valign="middle" style="width:58px;padding-right:13px"><img src="${esc(RILEY_AVATAR_URL)}" width="58" height="58" alt="Riley, the WSS Labs AI assistant" style="display:block;border-radius:50%;border:2px solid ${design.mix(A, "#FFFFFF", 0.6)}"></td>
        <td valign="middle">
          ${eyebrow("&#9670;&nbsp; INCLUDED WITH EVERY BUILD", A)}
          <div style="${body(18, PALETTE.ink, 900)};line-height:1.2">Meet Riley &mdash; your own web developer.</div>
          ${riley.telHref ? `<div style="margin-top:4px"><span style="display:inline-block;background:${design.mix(GREEN, "#FFFFFF", 0.88)};border:1px solid ${design.mix(GREEN_DEEP, "#FFFFFF", 0.6)};border-radius:999px;padding:2px 9px;font-family:${FONT_STACK};font-size:9.5px;font-weight:800;letter-spacing:.1em;color:${GREEN_DEEP};text-transform:uppercase">&#9679; Call any time</span></div>` : ""}
        </td>
      </tr></table>
      <p style="margin:12px 0 0;${body(15, A, 700)};line-height:1.45">Your own web developer, on the phone. Not a chatbot for your customers &mdash; he works for you: you call, and your site changes.</p>
      ${riley.telHref ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 0"><tr>
        <td align="center" style="padding:12px 16px 10px;background:rgba(255,255,255,.78);border:1px solid rgba(255,255,255,.98);border-radius:12px;box-shadow:0 8px 20px rgba(37,58,142,.12),inset 0 1px 0 #FFFFFF">
          ${rileyRobot({})}
          <div style="margin-top:6px;${body(8.5, PALETTE.muted, 800)};letter-spacing:.18em;text-transform:uppercase">Riley &mdash; half robot, all web developer</div>
        </td>
      </tr></table>` : ""}
      <div style="margin-top:14px;text-align:center">${gradButton({ href: talkRileyHref, label: "&#127908;&nbsp; TALK TO RILEY NOW", from: A, to: ACCENT_TO, ink: onAccent, size: 16, height: 54, radius: 12 })}</div>
      ${riley.telHref ? `<div style="margin-top:4px;text-align:center">${telTextLink()}</div>` : ""}
      ${clientId ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:12px"><tr><td align="center" style="padding:12px 14px 13px;background:rgba(255,255,255,.78);border:1px solid rgba(255,255,255,.98);border-radius:12px;box-shadow:0 8px 20px rgba(37,58,142,.12),inset 0 1px 0 #FFFFFF">
          <div style="${body(9.5, PALETTE.muted, 800)};letter-spacing:.2em;text-transform:uppercase">Tell Riley this is you &mdash; Client&nbsp;ID</div>
          <div style="margin-top:4px;font-family:${design.FONT_MONO};font-weight:700;font-size:26px;line-height:1.15;letter-spacing:.08em;color:${PALETTE.ink}">${esc(clientId)}</div>
          <div style="margin-top:4px;${body(10.5, PALETTE.muted, 600)}">Say it on the call or type it in your dashboard &mdash; same ID every time.</div>
        </td></tr></table>` : ""}
    </td></tr>
  </table>`, GUTTER) : "";

  // 12 · THE VALUE STACK. The approved market-rate line items (VALUE_STACK, from
  // lib/proof-email-inputs.js), summed from the rows so the band can never drift,
  // framed as what OTHERS charge — not a fee we levied. Rendered just above the
  // price card, whose pinned "IT IS ALREADY BUILT. HERE IS THE HONEST MATH."
  // eyebrow, $500-setup line and $149 stay put.
  //
  // POLISH MOCK 2026-09-02 — THE COMPARISON PASS (owner notes 2 and 3, one
  // block): "the honest math quadrant — give it MORE COLOR, highlight it" and
  // "add a SIDE-BY-SIDE comparison: WSS column with a check where included,
  // where others charge a ✗ or a $; make the GRAND TOTAL row highlighted
  // more." The old grey receipt becomes one coloured comparison table:
  //
  //   * the CARD is the accent wash with an accent top rule — colour, at last;
  //   * a navy HEADER BAND names the three columns, with the WSS column head
  //     in solid accent;
  //   * every row: what you get | the market price elsewhere (receipt mono) |
  //     the solid-check WSS column;
  //   * the GRAND TOTAL row is a full accent band — the loudest thing in the
  //     card, and deliberately still quieter than the price card below it,
  //     whose figures the owner wanted highlighted MORE than this quadrant
  //     (note 4: grand total at 16px, the price card's figures at 24px/62px).
  //
  // EVERY pinned string survives untouched: all row labels and prices, the
  // sums computed from the rows (never hand-typed), the "not a bill from us"
  // framing, and the "what agencies and SaaS tools charge" line.
  const stackSum = (rows) => rows.reduce((n, r) => n + (Number(r.amount) || 0), 0);
  const oneTimeTotal = stackSum(VALUE_STACK.oneTime);
  const monthlyTotal = stackSum(VALUE_STACK.monthly);
  const CMP_TINT = design.mix(A, "#FFFFFF", 0.88);
  const CMP_RULE = design.mix(A, "#FFFFFF", 0.78);
  // ── THE COMPANY GRID (v4, owner verbiage: NOT "elsewhere" — name the
  // companies). Two SAMPLE companies head their own columns, the market-price
  // anchors live down the first company's column (every VALUE_STACK price
  // string still renders — value-stack law), the DIY column mixes red ✗ with
  // a gray do-it-yourself stamp, and WSS is a solid check all the way down.
  // The grand-total row stacks each company's column against the $149.
  // The DIY monthly total is COMPUTED from the rows it claims (never
  // hand-typed), same arithmetic law as the two headline sums.
  const cmpCross = `<span style="font-family:${FONT_STACK};font-weight:900;font-size:13px;color:${PALETTE.danger}">&#10007;</span>`;
  const cmpDIY = `<span style="display:inline-block;background:${PALETTE.line};border-radius:3px;padding:2px 7px;font-family:${design.FONT_MONO};font-size:9px;font-weight:700;letter-spacing:.06em;color:${SLATE};text-transform:uppercase;white-space:nowrap">DIY</span>`;
  const cmpWss = `<span style="font-family:${FONT_STACK};font-weight:900;font-size:14px;color:${A}">&#10003;</span>`;
  // DIY includes only the last two monthly rows (reviews widget + hosting).
  const diyMonthlyFrom = VALUE_STACK.monthly.length - 2;
  const diyMonthlyTotal = VALUE_STACK.monthly
    .filter((_, i) => i >= diyMonthlyFrom)
    .reduce((n, r) => n + (Number(r.amount) || 0), 0);
  const cmpHeader = `<tr>
        <td align="left" bgcolor="${PALETTE.inkPanel}" style="background:${PALETTE.inkPanel};border-radius:6px 0 0 0;padding:9px 6px 9px 0;${body(10, "#FFFFFF", 800)};letter-spacing:.1em;text-transform:uppercase">What you get</td>
        <td align="center" bgcolor="${PALETTE.inkPanel}" style="background:${PALETTE.inkPanel};padding:8px 4px;${body(9, "#FFFFFF", 800)};letter-spacing:.06em;text-transform:uppercase;line-height:1.3">Coastline<br>Web Co.<div style="margin-top:2px;${body(7.5, PALETTE.inkPanelMuted, 700)};letter-spacing:.08em;text-transform:none">typical agency</div></td>
        <td align="center" bgcolor="${PALETTE.inkPanel}" style="background:${PALETTE.inkPanel};padding:8px 4px;${body(9, "#FFFFFF", 800)};letter-spacing:.06em;text-transform:uppercase;line-height:1.3">DIY Builder<br>Pro<div style="margin-top:2px;${body(7.5, PALETTE.inkPanelMuted, 700)};letter-spacing:.08em;text-transform:none">you do the work</div></td>
        <td align="center" width="56" bgcolor="${A}" style="width:56px;background:${A};border-radius:0 6px 0 0;padding:9px 2px;${body(10, onAccent, 900)};letter-spacing:.08em;text-transform:uppercase">WSS</td>
      </tr>`;
  const cmpGroup = (title) => `<tr>
        <td colspan="4" align="left" style="${body(10, A, 800)};letter-spacing:.12em;text-transform:uppercase;padding:13px 0 3px">${title}</td>
      </tr>`;
  const cmpRow = (r, diyCell) => `<tr>
        <td align="left" style="${body(12.5, PALETTE.ink, 600)};line-height:1.4;padding:7px 6px 7px 0;border-bottom:1px solid ${CMP_RULE}">${r.label}</td>
        <td align="center" style="padding:5px 3px;border-bottom:1px solid ${CMP_RULE}">${priceTag(r.price, { size: 10.5, pad: "2px 7px", mono: true })}</td>
        <td align="center" style="padding:6px 3px;border-bottom:1px solid ${CMP_RULE}">${diyCell}</td>
        <td align="center" width="56" bgcolor="${CMP_TINT}" style="width:56px;background:${CMP_TINT};padding:7px 2px;border-bottom:1px solid ${CMP_RULE}">${cmpWss}</td>
      </tr>`;
  const diyOneTimeCells = [cmpDIY, cmpCross, cmpCross];
  const diyMonthlyCell = (i) => (i >= diyMonthlyFrom ? priceTag(VALUE_STACK.monthly[i].price, { size: 10.5, pad: "2px 7px", mono: true }) : cmpCross);
  // THE GRAND TOTAL: every company's column stacked, against the one WSS line.
  const grandTotalRow = `<tr>
        <td align="left" bgcolor="${PALETTE.inkPanel}" style="background:${PALETTE.inkPanel};border-radius:0 0 0 6px;padding:12px 6px 12px 0;${body(10, "#FFFFFF", 800)};letter-spacing:.12em;text-transform:uppercase">Grand total</td>
        <td align="center" bgcolor="${PALETTE.inkPanel}" style="background:${PALETTE.inkPanel};padding:12px 3px;font-family:${design.FONT_MONO};font-weight:700;font-size:11.5px;line-height:1.4;color:#FFFFFF">~$${oneTimeTotal.toLocaleString("en-US")}<br>+ ~$${monthlyTotal.toLocaleString("en-US")}/mo</td>
        <td align="center" bgcolor="${PALETTE.inkPanel}" style="background:${PALETTE.inkPanel};padding:12px 3px;font-family:${design.FONT_MONO};font-weight:700;font-size:11.5px;line-height:1.4;color:#FFFFFF">~$${diyMonthlyTotal.toLocaleString("en-US")}/mo<div style="margin-top:2px;font-family:${FONT_STACK};font-weight:600;font-size:7.5px;letter-spacing:.06em;color:${PALETTE.inkPanelMuted};text-transform:uppercase">and you build it</div></td>
        <td align="center" bgcolor="${GREEN_DEEP}" style="background:${GREEN_DEEP};background-image:linear-gradient(135deg,${GREEN_DEEP} 0%,${design.mix(GREEN, GREEN_DEEP, 0.5)} 100%);border-radius:0 0 6px 0;padding:12px 2px">
          <div style="font-family:${FONT_STACK};font-weight:900;font-size:14px;line-height:1.1;color:#FFFFFF">&#10003;</div>
          <div style="margin-top:3px;font-family:${design.FONT_MONO};font-weight:700;font-size:11.5px;color:#FFFFFF">${esc(VALUE_STACK.price)}/mo</div>
        </td>
      </tr>`;
  const valueStackBlock = cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${GLASS_CARD};border-radius:12px;border-top:3px solid ${A}">
    <tr><td style="padding:16px 16px 18px">
      ${eyebrow("THE HONEST MATH", A)}
      <div style="${body(17, PALETTE.ink, 800)};line-height:1.3;padding-bottom:4px">Most local marketing website development companies</div>
      <div style="${body(12, PALETTE.muted)};line-height:1.5;padding-bottom:12px">Typical market prices for each piece &mdash; what agencies and SaaS tools charge. Sample companies shown for comparison. Not a bill from us. It's all already in your $149.</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">
        ${cmpHeader}
        ${cmpGroup("One-time build value")}
        ${VALUE_STACK.oneTime.map((r, i) => cmpRow(r, diyOneTimeCells[i] || cmpCross)).join("")}
        ${cmpGroup("Every month, elsewhere")}
        ${VALUE_STACK.monthly.map((r, i) => cmpRow(r, diyMonthlyCell(i))).join("")}
        ${grandTotalRow}
      </table>
      <div style="padding-top:8px;${body(10, PALETTE.muted)};line-height:1.5">DIY Builder Pro's small print: the build is on you. Coastline Web Co. is the full a-la-carte stack &mdash; every piece billed separately.</div>
    </td></tr>
  </table>`, GUTTER);

  // 12 (cont.) · PRICE — the navy sum band. Keeps the pinned eyebrow, the waived
  // $500 line (with SETUP_FEE_COVERS, which names the content / local-market /
  // eleven-checks work), and $149; adds the summed "others charge" band.
  //
  // POLISH MOCK 2026-09-02 — THE MONEY PASS (owner note 4): the ~$X,XXX-to-build
  // and monthly figures must be highlighted MORE than the comparison quadrant
  // above, and the waived setup fee must be impossible to miss. The figures now
  // sit at 24px/900 white (versus the grand total's 16px), each phrase kept as
  // one unbroken string; "waived." is a solid ACCENT_LIGHT badge with the navy
  // ink knocked out of it — the only bright fill on the card, so the eye lands
  // there first. START MY PLAN centres under the $149 (own centring law).
  // THE MONEY, ALL WEARING THE TAG (polish v2). The 24px bare white figures
  // become 19px figures INSIDE green price tags — the badge shape carries the
  // highlight now, so the navy card reads: tag, tag, struck $500, green WAIVED
  // tag, and then THE price tag itself: $149 drawn as an actual tag — emerald
  // plate, punched hole, hero-size figure. The big $149 stays the loudest
  // object in the email; the tags unify every smaller figure around it.
  // Each phrase stays one unbroken string inside its tag (the sums are the
  // rows' arithmetic, never hand-typed — value-stack law).
  const moneyTag = (figure) => `<span style="display:inline-block;${TAG_BG};border-radius:10px;padding:5px 14px;font-family:${FONT_STACK};font-weight:900;font-size:19px;line-height:1.25;color:#FFFFFF;letter-spacing:-.01em;white-space:nowrap;vertical-align:middle">${figure}</span>`;
  const priceCard = cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:${PALETTE.inkPanel};background-image:linear-gradient(150deg,${design.mix(PALETTE.inkPanel, VIOLET, 0.22)} 0%,${PALETTE.inkPanel} 50%,${design.mix(PALETTE.inkPanel, A, 0.16)} 100%);${GLASS_DARK_FINISH};border-left:4px solid ${A};border-radius:12px">
    <tr><td style="padding:26px 24px">
      ${eyebrow("IT IS ALREADY BUILT. HERE IS THE HONEST MATH.", ACCENT_LIGHT)}
      <p style="margin:0;${body(15, PALETTE.inkPanelInk)};line-height:1.9">Others charge ${moneyTag(`~$${oneTimeTotal.toLocaleString("en-US")} to build`)} + ${moneyTag(`~$${monthlyTotal.toLocaleString("en-US")}/mo`)} for the tools above.</p>
      <div style="margin:14px 0 0"><s style="${body(15, PALETTE.inkPanelMuted, 700)}">$500 setup fee</s> &nbsp;<span style="display:inline-block;${TAG_BG};color:#FFFFFF;border-radius:999px;padding:5px 14px;font-family:${FONT_STACK};font-weight:900;font-size:13px;letter-spacing:.1em;text-transform:uppercase;vertical-align:middle">Waived</span></div>
      <p style="margin:6px 0 18px;${body(12, PALETTE.inkPanelMuted)};line-height:1.5">Covers ${setupFeeCovers}</p>
      <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>
        <td bgcolor="${GREEN_DEEP}" style="background:${GREEN_DEEP};background-image:linear-gradient(135deg,${GREEN_DEEP} 0%,${design.mix(GREEN, GREEN_DEEP, 0.55)} 78%,${GREEN} 100%);border-radius:18px;box-shadow:0 3px 0 ${design.mix(GREEN_DEEP, "#000000", 0.35)},0 14px 30px ${design.mix(GREEN_DEEP, "#000000", 0.4)}59">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="30" valign="middle" align="center" style="width:30px;padding-left:18px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>
                <td width="14" height="14" bgcolor="#FFFFFF" align="center" valign="middle" style="width:14px;height:14px;background:#FFFFFF;border-radius:50%;font-size:0;line-height:0"><div style="width:5px;height:5px;background:${GREEN_DEEP};border-radius:50%;margin:0 auto;font-size:0;line-height:0">&nbsp;</div></td>
              </tr></table>
            </td>
            <td valign="middle" style="padding:16px 26px 18px 10px;font-family:${FONT_STACK};font-weight:900;font-size:56px;line-height:1;color:#FFFFFF;letter-spacing:-.025em;text-align:center">$149<span style="font-size:20px;font-weight:800;color:${design.mix(GREEN, "#FFFFFF", 0.75)}">/mo</span></td>
          </tr></table>
        </td>
      </tr></table>
      <div style="margin-top:12px;text-align:center;${body(13, PALETTE.inkPanelInk, 700)}">No setup fee &nbsp;&middot;&nbsp; Cancel anytime &mdash; everything above included</div>
      ${checkoutUrl ? `<div style="margin-top:18px;text-align:center">${gradButton({ href: checkoutUrl, label: "START MY PLAN &nbsp;&rarr;", from: A, to: ACCENT_TO, ink: onAccent, size: 17, height: 54, radius: 12, pad: 0, full: true, sweep: true })}</div>
      <div style="margin-top:8px;text-align:center;${body(11, PALETTE.inkPanelMuted)}">Secure checkout. Cancel any time, from the first month.</div>` : ""}
    </td></tr>
  </table>`, GUTTER);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
<style>
/* THE ONE STYLE BLOCK, AND WHY IT IS SAFE TO HAVE (final polish, 2026-09-03).
   Everything critical renders from inline styles alone — this block is purely
   the animated half of the primary CTAs' light-sweep. Clients that strip head
   CSS (or drop keyframes, as Gmail does) simply keep the baked static sweep
   state; Outlook desktop ignores animation outright. Progressive enhancement,
   never a dependency. */
@keyframes wssSweep{0%{background-position:130% 0,0 0,0 0}45%{background-position:-30% 0,0 0,0 0}100%{background-position:-30% 0,0 0,0 0}}
.wss-sweep{animation:wssSweep 3.6s linear infinite}
@media (prefers-reduced-motion:reduce){.wss-sweep{animation:none}}
</style>
</head>
<body style="margin:0;padding:0;${GLASS_PAGE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${GLASS_PAGE};padding:20px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
       style="width:100%;max-width:600px;box-sizing:border-box;border-radius:16px;${GLASS_SHEET}">

  <tr><td style="padding:20px 24px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
      <td valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle" style="padding-right:10px"><img src="${esc(WSS_MARK_URL)}" width="34" height="34" alt="WSS Labs" style="display:block;width:34px;height:34px;border-radius:9px"></td>
          <td valign="middle">
            <div style="font-family:${FONT_STACK};font-weight:800;font-size:15px;letter-spacing:.01em;color:${PALETTE.ink}">WSS Labs</div>
            <div style="font-family:${FONT_STACK};font-size:11px;color:${PALETTE.muted};padding-top:2px">American&nbsp;AI web studio&nbsp;<img src="${US_FLAG_URL}" width="16" height="13" alt="The flag of the United States" style="display:inline-block;width:16px;height:auto;aspect-ratio:16/13;vertical-align:-2px;border-radius:2px"></div>
          </td>
        </tr></table>
      </td>
      ${nameChip ? `<td align="right" valign="middle" style="padding-left:10px">${nameChip}</td>` : ""}
    </tr></table>
  </td></tr>

  ${heroNavy}

  <!-- MOBILE-FIRST PROOF (owner, 2026-08-13): lead with the theirs-vs-ours PHONE
       pair and DROP the desktop before/after strip — "the mobile has to be razzle
       dazzle amazing versus theirs", and most prospects read this on a phone. The
       desktop strip (heroBlock) survives ONLY as a fallback for a row that has no
       mobile-pair evidence, so no email ever loses its before/after entirely.
       Reviews (trust band + quote) sit BELOW the comparison. -->
  ${mobilePairBlock || heroBlock}

  ${trustBand}

  ${quoteCard}

  ${freeBackend}

  ${wssConnect}

  ${cell(`<div style="border-top:1px solid ${PALETTE.line};padding-top:16px"></div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px"><tr>
      <td width="64" height="4" bgcolor="${A}" style="width:64px;height:4px;background:${A};background-image:linear-gradient(90deg,${A} 0%,${VIOLET} 100%);border-radius:999px;font-size:0;line-height:0">&nbsp;</td>
    </tr></table>
    ${eyebrow("WHAT YOU GET", A)}
    <div style="${body(17, PALETTE.ink, 800)};padding-bottom:4px">All of it is in the <span style="color:${GREEN_DEEP}">$149.</span></div>
    <div style="${body(12, PALETTE.muted)};line-height:1.5;padding-bottom:14px">Not add-ons. Not a pitch. Open the preview and click around &mdash; it all works right now. Prices are what these cost everywhere else.</div>
    ${showcase}
    <div style="padding-top:8px">${chips}</div>`, GUTTER)}

  ${meetRiley}

  ${americanModelsBlock}

  ${gradeGraphic || signalReportLink}

  ${storyBlock}

  ${valueStackBlock}

  ${priceCard}

  ${doorsBlock}

  ${idFallback}

  ${cell(`<div style="border-top:1px solid ${PALETTE.line};padding-top:16px"></div>
    <p style="margin:0;text-align:center;${body(13, PALETTE.ink, 600)}">
    Want the 60-second tour? Reply with one word: <span style="font-family:${FONT_STACK};font-weight:900;font-size:17px;letter-spacing:.05em;color:${A}">WALKTHROUGH</span> &mdash; we send a short video.<br>
    <span style="${body(12, PALETTE.muted)}">No card. No call. No pressure.</span>
  </p>`, GUTTER)}

  ${cell(`<p style="margin:0;text-align:center;${body(13, PALETTE.muted)}">
    Worst case, you got a free look at a better version of your site.
  </p>${expires ? `<p style="margin:8px 0 0;text-align:center;${body(12, PALETTE.muted, 700)}">
    We keep your preview on our server until <span style="color:${PALETTE.ink}">${esc(expires)}</span>.
  </p>` : ""}${countdownGifUrl ? `<div style="margin-top:10px;text-align:center">
    <img src="${esc(countdownGifUrl)}" width="140" alt="Time remaining on your preview" style="display:inline-block;max-width:140px;height:auto;border-radius:8px">
  </div>` : ""}`, GUTTER)}

  ${(connectMagicLink || o.connectIncluded === true) ? cell(`<p style="margin:0;${body(12, PALETTE.muted)}">
    ${connectMagicLink
    ? `WSS Connect &mdash; one inbox for your messages, on your phone: <a href="${esc(connectMagicLink)}" style="color:${A};font-weight:700">open WSS Connect</a>.`
    : `WSS Connect &mdash; one inbox for your messages, set up for you when you start. It is part of the $149 &mdash; there is nothing extra to buy.`}
  </p>`, GUTTER) : ""}

  <tr><td style="padding:18px 24px 22px;border-top:1px solid ${PALETTE.line}">
    <div style="${body(13, PALETTE.ink, 800)}">WSS Labs</div>
    ${ownerProof
      ? `<div style="margin-top:5px;${body(12, PALETTE.muted)}">Owner-only Practice proof &mdash; no prospect was emailed.</div>`
      : `${postal ? `<div style="margin-top:5px;${body(12, PALETTE.muted)}">${esc(postal)}</div>` : ""}
    <!-- The promise, imported and rendered as its own paragraph. It must be the
         ONLY line in this half carrying the STOP keyword, and it must decode
         back to the identical characters the plain-text half ships, or the two
         renderings of one message disagree about how to opt out. -->
    <div style="margin-top:5px">${optOutPromiseHtml()}</div>
    ${unsub ? `<div style="${body(12, PALETTE.muted)}"><a href="${esc(unsub)}" style="color:${PALETTE.muted}">Unsubscribe</a></div>` : ""}`}
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    business ? `${business} — we already built your new website.` : "We already built your new website.",
    "It is live right now. You pay nothing to look at it.",
    preview ? `Open your live preview: ${preview}` : "",
    // The phone comparison, in the only form plain text can carry it: the
    // claim and the link. Gated on the same facts, shape for shape, as the
    // HTML block, so the two halves agree about whether the comparison exists
    // AND about which comparison it is.
    (preview && mobileShot && beforeMobileShot)
      ? `Most of your customers are on their phone. We put your site as phones show it today next to your new one${beforeHref ? ` — yours: ${beforeHref}` : ""} — the new one: ${preview}`
      : (preview && mobileShot && afterShot)
        ? `Most of your customers are on their phone. Your new site is built for that — open it on yours: ${preview}`
        : "",
    // TRUST, HIGH — the same figures and quotes the HTML band and quote card
    // carry, gated identically (the parity law). The band needs both numbers;
    // each quote needs its text. An absent fact drops its line, never a blank.
    ...((ratingNum !== null && reviewsNum !== null)
      ? [`${rating} stars on Google · ${reviewsLabel} reviews${credentialTextPlain ? ` · ${credentialTextPlain}` : ""}`]
      : []),
    // THE THIN-TARGET PITCH, both halves (issue #689): the same words the HTML
    // trust band carries when the mine measured the reviews gap, never here
    // alone. Gated on the identical expression — absent flag or absent numbers
    // means BOTH halves stay silent.
    ...(thinTargetReviewsLinePlain ? [thinTargetReviewsLinePlain] : []),
    ...reviewQuotes.map((q) => `  "${quoteTextPlain(q.text)}"${q.author ? ` — ${q.author}, on Google` : ""}`),
    "",
    // WHAT YOU GET — the same claims as the tiles and chips, one line each.
    "WHAT YOU GET — ALL OF IT IS IN THE $149:",
    ...bullets.map((b) => `- ${b}`),
    // BUILT WITH AMERICAN AI — the umbrella line, the same words as the HTML
    // strip in the value section. A claim about our own stack: always present.
    AMERICAN_MODELS_LINE,
    // BOTH HALVES GATE ON THE REPORT, OR NEITHER DOES (fixed 2026-08-07).
    //
    // The HTML wraps the entire grade card in `${roadMap ? ... }`. This half
    // does the same, through the same expression: with a grade and no
    // reportUrl the long form printed an unsourced accusation in the half a
    // text-only client renders. The wording mirrors the HTML branch for
    // branch, and the score — which the HTML shows in the badge — is spelled
    // out here because plain text has no badge.
    ...(roadMap ? ["", textGradeLine] : []),
    ...(roadMap && gradeReasons.length ? ["What's holding you back:"] : []),
    ...(roadMap ? gradeReasons.map((r, i) => `  ${i + 1}. ${r}`) : []),
    roadMap && gradeReasons.length
      ? "Every one of these is ours to fix — in the order your report lays out."
      : "",
    roadMap ? `See your road map: ${roadMap}` : (report ? `Open your Signal Report: ${report}` : ""),
    // LOCAL MARKET AUTHORITY (owner, 2026-08-16) — same gate in both halves:
    // the line prints only when a caller really measured a local scan
    // (scannedCount) AND the report it points at exists. Absent either, no
    // line — the truth law, same as every other block in this file.
    roadMap && scanned ? `We checked the local competition${city ? ` around ${city}` : ""} — this report shows exactly where you stand.` : "",
    "",
    // The two canon stories, exactly as the HTML tells them.
    whyYouText,
    americanText,
    "",
    "$149/month. Cancel anytime.",
    `Others charge about $${oneTimeTotal.toLocaleString("en-US")} to build plus about $${monthlyTotal.toLocaleString("en-US")}/mo for the tools — you pay $149/mo, everything above included.`,
    // The SAME STRING the HTML half renders, minus the markup — not a copy of
    // it. Two hand-kept copies of one promise is how the halves drift.
    `$500 setup fee, waived — covers ${setupFeeCovers}`,
    // BOTH HALVES OR NEITHER. A button the HTML half carries and the text half
    // does not is the two-different-emails defect in miniature.
    checkoutUrl ? `Start your plan: ${checkoutUrl}` : "",
    // THE CLAIM CARD'S TEXT HALF (2026-09-03). The HTML half's dashboard card
    // now renders in BOTH states — provisioned keeps the sign-in door below,
    // unprovisioned becomes a claim-path CTA — and this line is that CTA's
    // plain-text mirror under the same BOTH-HALVES law. It is claim-worded,
    // never live-worded: an unprovisioned row cannot be logged into, so no
    // sign-in, PIN or "switched on" wording may appear in this state.
    !dashboardDoor ? "Your customer dashboard is ready to claim — it comes with your plan." : "",
    "",
    "Riley, our AI assistant: call any time, say what you want changed, and it is done while you are on the phone.",
    // BOTH HALVES, SAME AFFORDANCES (final polish, 2026-09-03): the HTML half's
    // big Riley buttons open the VAPI web-call surface, so the text half names
    // it too when it exists — a text-only reader gets the web call and the
    // dial, never just one.
    talkToRileyUrl ? `Talk to Riley in your browser — no phone needed: ${talkToRileyUrl}` : "",
    riley.display ? `Call Riley free right now: ${riley.display}${clientId ? ` (Client ID ${clientId})` : ""}` : (clientId ? `Your client ID: ${clientId}` : ""),
    // THE THREE DOORS, IN THE SAME ORDER AND UNDER THE SAME NUMBERS AS THE
    // CARD ABOVE (doorNumbers). Everything the HTML half prints is here,
    // including the sign-in pair — a text-only client must be able to open
    // the dashboard too, or the two renderings of this message give different
    // people different amounts of access to the thing they are paying for.
    ...(doors.length ? ["", "HOW TO GET IN:"] : []),
    preview ? `${doorNumbers.site}. Your new website — open it, look around, send it to anyone: ${preview}` : "",
    dashboardDoor ? `${doorNumbers.dashboard}. Your dashboard — ask for a change to your site in plain words, and watch it happen: ${dashboardMagicLink || dashboardUrl}` : "",
    dashboardDoor ? (dashboardMagicLink
      ? `   One tap — no password. Or sign in by hand at ${dashboardUrl} — Email: ${dashboardEmail} / PIN: ${dashboardPin}`
      : `   Sign in with these two things — Email: ${dashboardEmail} / PIN: ${dashboardPin}`) : "",
    dashboardDoor ? "   Same PIN every time — keep this email." : "",
    riley.telHref ? `${doorNumbers.riley}. Call Riley — say what you want changed and it is done while you are on the line: ${riley.display}` : "",
    riley.telHref && clientId ? `   Tell him this is you: ${clientId}` : "",
    "",
    "Want the 60-second tour? Reply with one word: WALKTHROUGH",
    "No card. No call. No pressure.",
    "",
    "Worst case, you got a free look at a better version of your site.",
    expires ? `We keep your preview on our server until ${expires}.` : "",
    "",
    connectMagicLink
      ? `WSS Connect — one inbox for your messages: ${connectMagicLink}`
      : (o.connectIncluded === true ? "WSS Connect — one inbox for your messages, set up for you when you start. Included in the $149." : ""),
    // THE COMPLIANCE BLOCK IS THE CALLER'S, AND ONLY THE CALLER'S.
    // lib/email.js appends complianceFooter().text — the sender name, the
    // postal address, the shared OPT_OUT_PROMISE, the signed unsubscribe URL
    // and the support address — to whatever the composer returns. The HTML
    // half above renders the shared promise via optOutPromiseHtml(); this
    // half receives it from the footer. One promise, one definition, both
    // halves.
  ].filter(Boolean).join("\n");

  return { subject, preheader, html, text };
}

// GRADE_LADDER is exported so lib/proof-email-inputs.js can reject an
// off-scale grade at the MAPPING boundary as well as here. Two independent
// whitelists reading one list is defence in depth; two lists would be the
// beginning of the next divergence.
module.exports = {
  composeOutreachEmailV3,
  expiryLabel,
  gradeReasonsFromCategories,
  gradeBarsFromCategories,
  gradeStrengthsFromCategories,
  targetGrade,
  GRADE_LADDER,
  // Exported so test/report-grade.test.js can assert that every category key
  // lib/report-grade.js is willing to emit has a plain-English label here. The
  // fallback in gradeReasonsFromCategories is the RAW KEY, so a missing entry
  // does not fail loudly — it ships "businessIntelligence — F, 40/100" to a
  // plumber.
  CATEGORY_LABEL,
};
