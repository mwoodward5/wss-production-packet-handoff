"use strict";

// lib/proof-email-inputs.js — THE ONE PLACE A STORED PROSPECT BECOMES
// composeOutreachEmailV3() OPTIONS.
//
// WHY THIS IS ITS OWN FILE. The mapping is where fabrication gets introduced.
// Every "?? 0", every "|| 'B'", every "grade || 'not measured'" that has ever
// shipped in this system was written at a call site, inline, inside a function
// too long to review — and each one turned "we never measured that" into a
// statement about a real business. Pulling the mapping out means it can be
// unit-tested against a full record, a sparse record and an empty object with
// no email machinery in the way, and lib/email.js keeps one readable branch.
//
// THE RULE, WITHOUT EXCEPTION: an absent, empty, malformed or unverifiable
// field emits NO KEY AT ALL. composeOutreachEmailV3 removes the block for a
// missing option, so omission is how a fact we do not have stays unsaid. There
// is no default grade, no default score, no default review count, no default
// rating, no default expiry date, and no placeholder business name. A key that
// appears in the returned object is a claim we can source.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO:
//
//   * It does not read the network or the store. The compose call in
//     lib/email.js is synchronous, so a mapping that needed an await could not
//     live there. Anything that requires a lookup (the `line.batch` scan count,
//     a WSS Connect magic link, and now the LINKED REPORT'S OWN GRADE) is
//     accepted as an explicit argument from a caller that has already done the
//     work, and is simply absent otherwise. sendSequenceStep IS async, so the
//     await happens there, immediately above the compose call — see the
//     `reportFacts` argument. Keeping this mapper pure is exactly why the
//     fail-closed rules below can be unit-tested against literal objects with
//     no network anywhere in the way.
//   * It does not re-derive anything the send path already gated. The preview
//     URL, the before/after shot URLs and the client id arrive through `cta`,
//     which lib/email.js has already put through the approved-host check, the
//     preview-belongs-to-this-prospect check and the before-shot identity
//     check. Re-deriving them here would create a second, ungated source of
//     the same values — which is precisely how a stranger's screenshot gets
//     captioned "your site today".
//   * It does not pass `industry`. composeOutreachEmailV3 does not read that
//     option, and unlike the V2 composer it has no assertKnownComposeOptions
//     guard to say so — an unread option is silently dropped, which is the
//     exact defect COMPOSE_OPTION_KEYS was added to lib/outreach-email-v2.js
//     to stop. PROOF_EMAIL_V3_OPTION_KEYS below is the equivalent guard for
//     this boundary, and assertKnownProofEmailInputs enforces it.

const { safeReportUrl } = require("./report-url");
const { resolveRileyLine } = require("./riley-line");

// ---------------------------------------------------------------------------
// THE VALUE STACK — approved market-rate anchors, editable in ONE place.
// ---------------------------------------------------------------------------
//
// NOT A PER-PROSPECT FACT, so it is NOT a mapper option and is NOT on the
// allowlist: it is the SAME for every prospect, the way SETUP_FEE_COVERS and the
// American-AI line are. It is a config CONSTANT the composer imports and renders
// verbatim (lib/outreach-email-v3.js), and it lives here because the owner keeps
// the pricing and asked for the numbers to be editable in the inputs file.
//
// FRAMING LAW (owner-approved, 2026-08-12): every figure is the TYPICAL MARKET
// COST of that one piece bought elsewhere — what an agency or a SaaS tool
// charges — NOT a fee WSS levied. The email says so in those words. The client
// pays $149/mo; these numbers exist only to show what that one price replaces.
//
// The sums are computed from the line items (never hand-typed) so the band can
// never drift from the rows: one-time 4,500 + 1,000 + 20 = 5,520; monthly
// 99 + 99 + 97 + 197 + 300 + 59 + 25 = 876. test/email-value-stack.test.js pins
// both totals and the exact rows.
const VALUE_STACK = Object.freeze({
  oneTime: Object.freeze([
    Object.freeze({ label: "Custom local-business website (design & build)", price: "$4,500", amount: 4500 }),
    Object.freeze({ label: "Local findability report (the “$1,000 report”)", price: "$1,000", amount: 1000 }),
    // TRUTH LAW (2026-08-13): we do NOT register or buy domains — lib/domains.js
    // is a dry-run integration and nothing purchases one today (the same policy
    // scripts/smoke-tests enforces). The old "Your own domain, registered &
    // connected" promised a service we never deliver; replaced with the one-time
    // work we DO perform — deploying the finished site and taking it live. Same
    // $20 market anchor, so the one-time total is unchanged.
    Object.freeze({ label: "Site launch & go-live setup", price: "$20", amount: 20 }),
  ]),
  monthly: Object.freeze([
    Object.freeze({ label: "On-site AI chat & booking agent", price: "$99/mo", amount: 99 }),
    Object.freeze({ label: "24/7 missed-call text-back", price: "$99/mo", amount: 99 }),
    Object.freeze({ label: "Unified inbox + CRM (WSS Connect)", price: "$97/mo", amount: 97 }),
    Object.freeze({ label: "Web developer on call, unlimited edits (Riley)", price: "$197/mo", amount: 197 }),
    Object.freeze({ label: "Maps & “near-me” local SEO", price: "$300/mo", amount: 300 }),
    Object.freeze({ label: "Reviews widget + reputation", price: "$59/mo", amount: 59 }),
    Object.freeze({ label: "Managed hosting + SSL", price: "$25/mo", amount: 25 }),
  ]),
  // The one flat price everything above is replaced by. Kept here so a price
  // change is a one-line edit next to the value it is measured against.
  price: "$149",
});

/**
 * Every option composeOutreachEmailV3 actually reads, verified against
 * lib/outreach-email-v3.js. `industry` is absent on purpose — see above.
 * Anything this module emits must be on this list, and a name that stops being
 * read by the composer must come off it.
 */
const PROOF_EMAIL_V3_OPTION_KEYS = Object.freeze([
  "businessName",
  "city",
  "previewUrl",
  // The prospect's OWN site — the destination of the "Before" thumbnail. It is
  // NOT a second preview surface: the composer uses it for that one link and
  // nothing else, and drops the link entirely when it is absent.
  "currentUrl",
  "reportUrl",
  "checkoutUrl",
  "beforeImage",
  "afterImage",
  // The mirror at 390 in a phone frame — the mobile-vs-desktop pair. Minted by
  // lib/email.js's shotUrl("new-mobile") and evidence-gated there: no recorded
  // mobile pixel digest means no key, and the composer drops the whole pair.
  "mobileImage",
  // THE PROSPECT'S OWN SITE at 390 — the other half of the theirs-vs-ours
  // phone comparison. Minted by shotUrl("old-mobile") behind the hardest gate
  // in the family: recorded pixel digest AND an identity-proven landing URL
  // AND a current website on file. Absent, the composer adapts the block to
  // the ours-only phone/desktop pair — never a spacer, never a stale image.
  "beforeMobileImage",
  "afterAnimUrl",
  // HOW that loop was captured — the generator's anim_lane ("hero" = their own
  // hero video really playing; "pan" = a scripted scroll over a dead hero).
  // The composer's motion copy ("Watch it move — live footage") is honest only
  // for the hero lane, so this travels beside the URL and anything that is not
  // "hero" — including its absence on old rows — renders as "preview", never
  // as live video.
  "afterAnimLane",
  "clientId",
  "rating",
  "reviewCount",
  "postalAddress",
  "unsubUrl",
  "ownerProof",
  // Positive truth marker carried only by an owner Practice whose mine-time
  // locality evidence was explicitly provisional. The composer uses it to
  // remove every local-market claim; absence preserves the verified path.
  "marketProvisional",
  "expiresAt",
  "scannedCount",
  "grade",
  "gradeScore",
  "gradeReasons",
  // The same weakest-three selection as gradeReasons, as DATA ({label, grade,
  // score}) so the composer can draw them as bars — the owner's "not graphical
  // enough" fix. Computed beside the reasons from the identical report
  // categories, so the sentences and the bars cannot cite different failings.
  "gradeBars",
  "gradeStrengths",
  // TRUST, REPACKAGED (2026-08-12). The owner's "put the trust signals back in
  // the email" pass. `reviewQuotes` is the prospect's own Google reviews as
  // quote objects ({ text, author?, avatarUrl?, rating? }) for the composer's
  // quote card — the same corpus the mirror rail renders, pinned by place_id.
  // `yearsInBusiness` / `licensed` / `insured` are the credentials for the trust
  // band's second row. ALL fact-gated: an unheld datum emits no key, and the
  // composer removes exactly that pill (or the whole quote card / band).
  "reviewQuotes",
  "yearsInBusiness",
  "licensed",
  "insured",
  // THE THIN-TARGET PITCH LINE (issue #689). Strict `true`, emitted ONLY when
  // the mine-time integration-gap measurement (record.integration_gap, written
  // at 2_homepage_fetch off the same fetch the probe rides) measured a REVIEWS
  // gap: the prospect's CURRENT homepage showed no Google reviews and no
  // review widget. The composer renders the owner's line ("Your Google reviews
  // never showed on your old site — they're front and center on the new one.")
  // only beside the prospect's own verified review numbers, and never for a
  // site the mine saw showing its reviews. Absent emits no key, as everywhere.
  "integrationGap",
  // THEIR COLOUR. The verified brand accent the mirror itself wears
  // (build_ready brand contract via verifiedBrandOf, carried on cta.brandColor
  // / record.brand_color). Decoration, not a claim — the composer's
  // clientAccent() falls back to the WSS accent for an absent, unparseable or
  // design-lock-forbidden value, and never labels a fallback as measured.
  "brandColor",
  "rileyPhone",
  // THE VAPI WEB-CALL LINK for the "Talk to Riley now" button. A caller that has
  // wired the VAPI web-voice embed passes it; absent today (no embed URL exists
  // yet), and the composer falls the button back to the live-site chat / the tel
  // line rather than shipping a dead button. https-only, per-prospect.
  "talkToRileyUrl",
  "connectMagicLink",
  "connectIncluded",
  "countdownGifUrl",
  // THE DASHBOARD DOOR. All three or none — the composer's `dashboardDoor` is
  // the AND of them, because production's POST /api/connect/dashboard-login
  // requires the pair (either field missing answers 400 email_and_pin_required)
  // and a URL with nothing to type into it is not a door. Caller-supplied only:
  // the PIN is only true if the SAME call wrote the access row whose pin_hash
  // is sha256 of it, which is a live DB write this pure, synchronous module
  // must not do. See lib/email.js, which awaits prospectMagicLink() first.
  "dashboardUrl",
  "dashboardEmail",
  "dashboardPin",
  // THE ONE-TAP DASHBOARD LINK. Signed #t= auto-login URL from prospectMagicLink;
  // the composer leads the dashboard door with a button when it is present and
  // falls back to the email+PIN form when it is not. Caller-supplied via
  // dashboardAccess, same terms as the pair — only a call that provisioned the
  // access row may pass one.
  "dashboardMagicLink",
]);

/**
 * Copy that lib/email.js substitutes when it has no real value — see
 * effectiveBusinessName / effectiveCity / effectiveIndustry (email.js
 * L948-956). Those literals exist so the V2 template's merge fields never
 * render "__MISSING__"; they are not facts, and the V3 composer degrades
 * gracefully without them ("We already built your new website." instead of
 * "your business, we already built your new website."). They are stripped
 * here so a placeholder cannot be mistaken for a name.
 */
const PLACEHOLDER_VALUES = new Set([
  "your business",
  "this business",
  "your area",
  "local service",
  "there",
]);

// ---------------------------------------------------------------------------
// THE FLAG
// ---------------------------------------------------------------------------

/**
 * GHOST_AGENCY_PROOF_EMAIL_V3 — the kill switch, DEFAULT ON.
 *
 * The owner wants V3 live, so the question this answers is not "was it turned
 * on" but "was it explicitly turned OFF". Absent, empty, whitespace, and
 * anything unrecognised all mean ON; only a recognised negative word turns it
 * off, and it can be set without a redeploy.
 *
 * WRITTEN DEFENSIVELY BECAUSE THIS CODEBASE KEEPS LOSING TO THE SAME TRAPS:
 *   * `Number("")` is 0 and `Number(null)` is 0, so any numeric coercion turns
 *     an unset variable into a real, falsy value. No Number() here.
 *   * `env.X ?? "true"` does NOT catch the empty string — `"" ?? "true"` is
 *     `""` — so a variable that exists but is blank falls through whatever
 *     branch follows. It is handled explicitly below.
 *   * `Boolean("false")` is true. String comparison, never coercion.
 *   * A missing `env` object at all must not throw.
 */
const PROOF_EMAIL_V3_OFF_VALUES = new Set([
  "0", "false", "off", "no", "n", "disabled", "disable",
]);

function proofEmailV3Enabled(env = process.env) {
  const raw = env == null ? undefined : env.GHOST_AGENCY_PROOF_EMAIL_V3;
  // Absent (undefined / null / never set) => ON.
  if (raw === undefined || raw === null) return true;
  const normalized = String(raw).trim().toLowerCase();
  // Present but blank => ON. A blank variable is not a decision to disable.
  if (normalized === "") return true;
  // Only a recognised negative disables it. Junk ("maybe", "1.0", "yes please")
  // leaves the owner's default in place rather than silently reverting to V2.
  return !PROOF_EMAIL_V3_OFF_VALUES.has(normalized);
}

// ---------------------------------------------------------------------------
// COERCIONS THAT REFUSE TO INVENT
// ---------------------------------------------------------------------------

const httpsOnly = (value) => (
  /^https:\/\//i.test(String(value ?? "").trim()) ? String(value).trim() : ""
);

/**
 * Number, or null. Never 0 by accident.
 *
 * `Number("")`, `Number(null)`, `Number(" ")` and `Number([])` are all 0, and
 * `Number.isFinite(0)` is true, so the obvious guard reports "scored zero" for
 * a category we never measured. Same contract as numOrNull in
 * lib/outreach-email-v3.js — repeated rather than imported so this module has
 * no load-time dependency on the composer (see composerModule() below).
 */
function numOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  if (String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function realName(value) {
  const text = cleanString(value);
  return PLACEHOLDER_VALUES.has(text.toLowerCase()) ? "" : text;
}

/**
 * Lazily loaded so this module can be required from lib/email.js without
 * creating a cycle: lib/outreach-email-v3.js requires lib/email.js for
 * gradeBadgeColor, and a top-level require here would make email.js depend on
 * a half-initialised copy of itself. require() is cached, so this costs one
 * map lookup per call.
 */
function composerModule() {
  return require("./outreach-email-v3");
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// ---------------------------------------------------------------------------
// THE MAPPING
// ---------------------------------------------------------------------------

/**
 * buildProofEmailInputs({...}) -> options object for composeOutreachEmailV3
 *
 * Synchronous and pure: same inputs, same output, no env read except the one
 * explicitly passed for the Riley line, no I/O.
 *
 * @param {object}  prospect   the canonicalised prospect row (lib/email.js has
 *                             already rewritten its recipient fields).
 * @param {object}  record     prospect.record — the evidence record.
 * @param {object}  cta        lib/email.js's proofCta. Already gate-checked.
 * @param {object}  footer     complianceFooter(prospect) result. Supplies the
 *                             postal address and the signed unsubscribe URL,
 *                             both of which are hard send-gates upstream.
 * @param {string}  businessName / city  lib/email.js's effective values.
 * @param {number?} scannedCount  only from a caller that has joined the
 *                             line.batch mine funnel. Never guessed here.
 * @param {object?} reportFacts  { grade, score, categories } as READ BACK OFF
 *                             THE LINKED REPORT by lib/report-grade.js. The
 *                             caller does the I/O (this file stays pure and
 *                             synchronous); absent means the report could not
 *                             be read, and absent means no grade at all.
 * @param {string?} connectMagicLink / countdownGifUrl / afterAnimUrl
 *                             forward-compatible surfaces with no working
 *                             source today; absent unless a caller proves one.
 * @param {boolean} connectIncluded  opt-in, default false. See below.
 * @param {object?} dashboardAccess  the RESULT of a completed
 *                             prospectMagicLink() provision —
 *                             { provisioned, dashboardUrl, ownerEmail, pin }.
 *                             Absent or provisioned:false removes the whole
 *                             sign-in door. Never derived here: the PIN is only
 *                             true if the same call wrote the row it unlocks.
 *                             Its ownerEmail must equal the prospect's own
 *                             address on a live send — see THE DASHBOARD
 *                             SIGN-IN for the one exception.
 * @param {boolean} sandbox    true ONLY on an owner proof (lib/email.js's
 *                             internalOwnerProof). The single thing that lets
 *                             the dashboard door print the agency owner's
 *                             address instead of the prospect's; default
 *                             false, so the live lane fails closed.
 * @param {boolean} marketProvisional  true only when the durable mine-time
 *                             provenance says the requested market remains a
 *                             routing hint rather than verified locality.
 * @param {object}  env        for the Riley line and the owner-proof address
 *                             comparison (GHOST_AGENCY_OWNER_EMAIL).
 * @param {number}  now        injectable clock, for the expiry check.
 */
function buildProofEmailInputs({
  prospect = {},
  record = null,
  cta = {},
  footer = null,
  businessName = "",
  city = "",
  scannedCount = null,
  reportFacts = null,
  connectMagicLink = "",
  countdownGifUrl = "",
  afterAnimUrl = "",
  afterAnimLane = "",
  talkToRileyUrl = "",
  connectIncluded = false,
  dashboardAccess = null,
  // THE SANDBOX FLAG (2026-08-16). True ONLY on an owner proof, where
  // lib/email.js's internalOwnerProof rebinds the recipient — and therefore
  // the access row, and therefore the sign-in the email prints — onto
  // GHOST_AGENCY_OWNER_EMAIL. Default false, and deliberately not derivable
  // here: a pure mapper cannot see the send's lane, so the LIVE lane fails
  // closed by omission. See the guard in THE DASHBOARD SIGN-IN below.
  sandbox = false,
  marketProvisional = false,
  env = process.env,
  now = Date.now,
} = {}) {
  const prospectRow = plainObject(prospect) || {};
  const evidence = plainObject(record) || plainObject(prospectRow.record) || {};
  const call = plainObject(cta) || {};
  const compliance = plainObject(footer) || {};
  const options = {};

  if (sandbox === true) options.ownerProof = true;
  if (sandbox === true && marketProvisional === true) options.marketProvisional = true;

  const set = (key, value) => {
    if (value === undefined || value === null || value === "") return;
    options[key] = value;
  };

  // -- IDENTITY ------------------------------------------------------------
  // Placeholder copy is stripped: the composer's own generic wording is more
  // honest than "your business, we already built your new website."
  set("businessName", realName(businessName) || realName(prospectRow.business_name)
    || realName(prospectRow.businessName) || realName(evidence.business_name));
  if (options.marketProvisional !== true) {
    set("city", realName(city) || realName(prospectRow.city) || realName(evidence.city));
  }

  // -- THE PROOF ITSELF ----------------------------------------------------
  // previewUrl has already passed isApprovedPreviewUrl() and
  // previewBoundToProspect() in lib/email.js. It is the one link the whole
  // email is about.
  const previewUrl = httpsOnly(call.previewUrl) || httpsOnly(call.revealUrl);
  set("previewUrl", previewUrl);

  // THE HERO IS GATED ON THE LINK, NOT JUST ON THE PICTURE. V3 wraps the
  // whole before/after card in <a href="${preview}"> but gates the card on the
  // AFTER image alone, so an after-shot with no preview URL ships
  // `<a href="">` around a panel captioned "After ▸ open it live" — a dead
  // button on a cold email, and an empty href that every structural test in
  // this suite refuses. On the live path the readiness gate guarantees a
  // preview, so this only ever fires for a caller using the mapping directly;
  // it costs nothing and it removes the failure mode entirely.
  if (previewUrl) {
    // Both shot URLs are minted by lib/email.js's shotUrl(). "old" is returned
    // as "" unless capturedShotBelongsTo() proved the screenshot was taken on
    // this prospect's own domain, so an absent beforeImage is a REFUSAL that
    // has already happened, not an oversight to paper over.
    set("beforeImage", httpsOnly(call.beforeImage));
    set("afterImage", httpsOnly(call.afterImage));
    // The phone frame of the same mirror. Rides the same gate as the after
    // still: a mobile shot with no preview to click through to is a picture
    // with no destination, and the composer's pair block links both halves.
    set("mobileImage", httpsOnly(call.mobileImage));
    // Their phone render, for the theirs-vs-ours comparison. Same preview
    // gate: without OUR half there is no comparison for it to be half of.
    set("beforeMobileImage", httpsOnly(call.beforeMobileImage));
    // WHERE THE "BEFORE" HALF POINTS. V3 wrapped both thumbnails in a single
    // anchor to the preview, so their own site's screenshot linked to our
    // mirror; the composer now links each half separately and needs their URL
    // to do it. Same value the identity gate above already compared the shot
    // against, so the link and the picture can only ever be the same site.
    // Absent = the composer renders the before half unlinked, never linked to
    // the preview.
    set("currentUrl", httpsOnly(call.currentUrl) || httpsOnly(call.currentWebsite));
    // No persisted source exists for an animated hero today (0/45 rows); it is
    // accepted only from a caller that has one.
    set("afterAnimUrl", httpsOnly(afterAnimUrl));
    // The loop's capture lane rides ONLY beside an accepted loop URL — a lane
    // with no loop is a claim about nothing, and the composer must not be told
    // "hero" about an <img> that was refused above.
    if (options.afterAnimUrl) set("afterAnimLane", cleanString(afterAnimLane));
  }

  // -- THE BUY LINK --------------------------------------------------------
  //
  // MINTED BY THE CALLER, NOT HERE, and gated on the same evidence as the rest
  // of the proof: no preview means there is nothing built to buy, so there is
  // no button either. lib/email.js mints it through prospectCheckoutUrl(),
  // which returns "" when the signing secret is unset or the prospect has no
  // id — both of which would produce a link that 401s on click. httpsOnly()
  // then refuses anything that is not an https URL, so the only way a key
  // appears here is a real, signed, prospect-bound link.
  //
  // Deriving it in this file instead would put a SECOND minting site next to
  // the one lib/email.js already has, which is how the preview URL grew two
  // ungated sources and captioned a stranger's screenshot "your site today".
  if (previewUrl) set("checkoutUrl", httpsOnly(call.checkoutUrl));

  // -- CLIENT ID -----------------------------------------------------------
  // Derived by clientReferenceCode() upstream, which is the same function
  // Riley recomputes to resolve a spoken code, so what the email prints and
  // what the phone agent accepts cannot disagree.
  set("clientId", cleanString(call.clientId));

  // -- THEIR COLOUR ---------------------------------------------------------
  // The verified brand accent from the same record the build wore
  // (cta.brandColor <- record.brand_color, written by the mine's brand
  // contract). Colour is decoration, not a claim, so this is the one field
  // with a safe fallback — but the fallback lives in the COMPOSER's
  // clientAccent(), which also refuses design-lock-forbidden hexes and keeps
  // `measured:false` on record. This boundary just refuses to pass junk shape:
  // anything that is not #RGB/#RRGGBB emits no key at all.
  const brandColor = cleanString(call.brandColor || evidence.brand_color || evidence.brandColor);
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(brandColor)) options.brandColor = brandColor;

  // -- THE REPORT AND THE GRADE -------------------------------------------
  //
  // THE GRADE IS TIED TO THE REPORT ON PURPOSE, AND THIS IS THE ONE PLACE
  // THAT DECISION LIVES.
  //
  // composeOutreachEmailV3 wraps the entire grade card in `${report ? ... }`,
  // but its PLAIN-TEXT half does not: with a grade and no report it prints
  // "We measured your site at D (41/100)." plus three numbered failings and no
  // link to anything backing them. That is an unsourced accusation against a
  // real business in the half of the message a text-only client renders, and
  // it makes the two MIME parts of one email say different things — the exact
  // class of defect test/opt-out-parity.test.js and
  // test/sequence-step-html-parity.test.js exist to catch.
  //
  // So a grade ships only WITH the report that substantiates it. 8 of 45
  // queued rows have a real report URL and 42 have a grade; the other 34 lose
  // a sentence they could not support anyway.
  const reportUrl = safeReportUrl(
    httpsOnly(call.reportUrl)
    || httpsOnly(prospectRow.report_url) || httpsOnly(prospectRow.reportUrl)
    || httpsOnly(evidence.report_url) || httpsOnly(evidence.reportUrl),
  );
  set("reportUrl", reportUrl);

  // THE GRADE IS THE REPORT'S, NOT THE DATABASE'S (changed 2026-08-07).
  //
  // This block used to read record.build_ready.qualification.composite_signal —
  // OUR score for the business. The linked report renders CALLPREP's score, and
  // across every row in the store that carries both (8 rows — the whole
  // population, not a sample) the two disagree on the SCORE 8 times out of 8
  // and on the LETTER 7 times out of 8: Goodson DB C+/77 vs page B/83, Holt DB
  // C-/72 vs page C+/78, North Side DB C/73 vs page D+/69. Same scan, same
  // pipeline run — on 6 of the 8 the two timestamps are under 50ms apart — two
  // different scorers. The reasons were worse than the letter: the DB scores a
  // `technology` category on 8 of 8 rows where the linked page prints "NOT
  // CAPTURED IN THIS REPORT VERSION", so the email listed a failing the report
  // says it never measured.
  //
  // `reportFacts` now arrives from lib/report-grade.js, which reads the exact
  // JSON the prospect's own browser fetches. See lib/report-grade.js for the
  // measurement and the field paths.
  //
  // THERE IS NO FALLBACK TO THE DATABASE, and there must never be one: "the DB
  // said C+" is precisely the wrong answer to "what does the page say". An
  // unreadable, timed-out or ungraded report emits no letter, no score and no
  // reasons, and the composer drops the whole card.
  if (reportUrl) {
    const facts = plainObject(reportFacts);
    const {
      GRADE_LADDER, gradeReasonsFromCategories, gradeBarsFromCategories, gradeStrengthsFromCategories,
    } = composerModule();

    // WHITELISTED, NEVER COERCED. A second, independent check on the letter the
    // report handed us — lib/report-grade.js already refuses an off-ladder
    // value, and this boundary refuses it again rather than trusting a caller.
    const gradeRaw = cleanString(facts && facts.grade).toUpperCase();
    const grade = GRADE_LADDER.includes(gradeRaw) ? gradeRaw : "";
    set("grade", grade);

    if (grade) {
      // The score renders inside the grade tile, so it is meaningless without
      // the letter. numOrNull keeps an unmeasured field from becoming 0, and a
      // report whose overall_score is 0 has already been refused upstream —
      // that is the "Analysis in progress" page, not an F.
      const score = numOrNull(facts && facts.score);
      if (score !== null && score > 0 && score <= 100) options.gradeScore = Math.round(score);

      // THE REASONS COME OFF THE SAME PAGE AS THE LETTER. Never computed from
      // the grade, and never from our own categories: lib/report-grade.js has
      // already dropped every category the report renders as "NOT CAPTURED IN
      // THIS REPORT VERSION" (its predicate is the page's own,
      // !Number.isFinite(score)), so a category cited here is a card the reader
      // can point at. A business with nothing under 90 yields [] and the block
      // disappears rather than manufacturing a complaint.
      const categories = plainObject(facts && facts.categories);
      const reasons = categories ? gradeReasonsFromCategories(categories) : [];
      if (Array.isArray(reasons) && reasons.length) options.gradeReasons = reasons;
      // The identical selection as data, for the bar graphic. Same source,
      // same filter, same cap — see gradeBarsFromCategories. Emitted only
      // beside real reasons-bearing categories; an empty list emits no key.
      const bars = categories ? gradeBarsFromCategories(categories) : [];
      if (Array.isArray(bars) && bars.length) options.gradeBars = bars;
      // The report opens with WHAT'S WORKING before it lists what is wrong, and
      // the email now does the same — that ordering is what makes "don't shoot
      // the messenger" land. Same source as the reasons: the report's own
      // categories, so a strength is only ever a 90+ the reader can go and see.
      const strengths = categories ? gradeStrengthsFromCategories(categories) : [];
      if (Array.isArray(strengths) && strengths.length) options.gradeStrengths = strengths;
    }
  }

  // -- TRUST NUMBERS -------------------------------------------------------
  // ALL OR NOTHING. A rating with no count is a number with no weight behind
  // it, and a count with no rating is worse; the composer already falls back
  // to a generic line, and this makes sure it never receives half a pair.
  const rating = numOrNull(call.rating ?? evidence.rating);
  const reviewCount = numOrNull(call.reviewCount ?? evidence.review_count ?? evidence.reviewCount);
  if (rating !== null && reviewCount !== null
    && rating > 0 && rating <= 5
    && Number.isInteger(reviewCount) && reviewCount >= 1) {
    options.rating = String(rating);
    options.reviewCount = String(reviewCount);
  }

  // -- TRUST QUOTES + CREDENTIALS ------------------------------------------
  //
  // THE PROSPECT'S OWN GOOGLE REVIEWS, brought into the email as the quote card
  // — the same corpus the mirror rail renders, pinned by place_id. The caller
  // resolves the list from record.build_ready.mirror_request.content.reviews and
  // hands it on cta.reviews; evidence.reviews is the fallback for a flatter
  // record. A REAL FACE, FIRST-PARTY ONLY: Google serves reviewer faces from
  // googleusercontent.com, which the email's first-party image law forbids — so
  // the caller (email.js) re-hosts the face through the signed preview-shot path
  // and hands it on as `faceUrl` on a *.wss-ai.com host. This carries that URL
  // only when it passes the same allowlist the image tests enforce; a raw
  // googleusercontent URL never survives, and no faceUrl means the composer
  // draws the reviewer's initial as a monogram. Maps text (REQUIRED), the
  // author's name, a 1..5 rating, and the guarded faceUrl. Capped at two — the
  // composer caps too, so a direct caller cannot over-fill the card.
  //
  // THE PRAISE BLOCK SELECTS ITS OWN PRAISE (2026-08-16, after the Ron Steele
  // sandbox send). That proof opened "WHAT YOUR CUSTOMERS ALREADY SAY" with a
  // 1-star rant ("This guy is extremely rude... cursed my wife out") because
  // the card quoted the first two reviews in ARRIVAL order — which is whatever
  // order Google handed back, not what the block is for. This is SELECTION,
  // never fabrication: not one word of any review is edited or summarised
  // (the truth law is absolute here); what changes is WHICH of the prospect's
  // own reviews the block quotes. The rule:
  //   * prefer rating >= 4 — the praise the eyebrow promises;
  //   * among equals, the more recent (publishedAt / published_at / date /
  //     unix `time`, whichever Google served);
  //   * only when fewer than two 4+ reviews exist, fill from the best of the
  //     rest, highest rating first (an unrated review ranks after a rated one
  //     — a number we hold beats a number we don't) — and NEVER a 1-star: the
  //     block that says "what your customers already say" must not lead with
  //     the worst thing a customer ever said.
  const reviewSource = (Array.isArray(call.reviews) && call.reviews.length)
    ? call.reviews
    : (Array.isArray(evidence.reviews) ? evidence.reviews : []);
  const reviewWhen = (r) => {
    const iso = cleanString(r && (r.publishedAt || r.published_at || r.date));
    const parsed = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(parsed)) return parsed;
    const unix = numOrNull(r && r.time);
    return unix !== null && unix > 0 && Number.isFinite(unix * 1000) ? unix * 1000 : 0;
  };
  const byPraiseThenRecency = (a, b) => ((b.rank ?? -1) - (a.rank ?? -1)) || (b.when - a.when);
  const mappedReviews = reviewSource
    .map((r) => {
      const text = cleanString(r && r.text);
      if (!text) return null;
      const author = cleanString(r && (r.author || r.authorName));
      const reviewRating = numOrNull(r && r.rating);
      const faceUrl = cleanString(r && r.faceUrl);
      const firstPartyFace = faceUrl && /^https:\/\/(?:[a-z0-9-]+\.)*wss-ai\.com\//i.test(faceUrl) ? faceUrl : "";
      return {
        quote: {
          text,
          ...(author ? { author } : {}),
          ...(reviewRating !== null && reviewRating >= 1 && reviewRating <= 5 ? { rating: reviewRating } : {}),
          ...(firstPartyFace ? { faceUrl: firstPartyFace } : {}),
        },
        // Ranking facts, carried alongside and never emitted on the quote.
        rank: reviewRating !== null && reviewRating >= 1 && reviewRating <= 5 ? reviewRating : null,
        when: reviewWhen(r),
      };
    })
    .filter(Boolean);
  const praise = mappedReviews
    .filter((m) => m.rank !== null && m.rank >= 4)
    .sort(byPraiseThenRecency);
  const fill = mappedReviews
    .filter((m) => !praise.includes(m) && (m.rank === null || m.rank >= 2))
    .sort(byPraiseThenRecency);
  const reviewQuotes = [...praise, ...fill].slice(0, 2).map((m) => m.quote);
  if (reviewQuotes.length) options.reviewQuotes = reviewQuotes;

  // YEARS IN BUSINESS — a held count, or a founding year we can subtract from
  // the current year. Never inferred from how old the reviews are; absent stays
  // absent, and the composer simply omits that pill.
  const yearsHeld = numOrNull(call.yearsInBusiness ?? evidence.years_in_business ?? evidence.yearsInBusiness);
  if (yearsHeld !== null && yearsHeld >= 1 && yearsHeld <= 200) {
    options.yearsInBusiness = Math.round(yearsHeld);
  } else {
    const founded = numOrNull(evidence.year_founded ?? evidence.founded_year ?? evidence.established_year);
    const thisYear = new Date(Number(typeof now === "function" ? now() : now) || Date.now()).getFullYear();
    if (founded !== null && founded >= 1800 && founded <= thisYear) {
      const yrs = thisYear - founded;
      if (yrs >= 1 && yrs <= 200) options.yearsInBusiness = yrs;
    }
  }

  // LICENSED / INSURED — strict booleans from a held signal only. A license
  // STRING is not proof of a current license, and an insurance claim we cannot
  // source is never printed, so these fire only on an explicit boolean true.
  if (call.licensed === true || evidence.licensed === true) options.licensed = true;
  if (call.insured === true || evidence.insured === true) options.insured = true;

  // -- THE THIN-TARGET PITCH (issue #689) ------------------------------------
  //
  // Conversion-upside provenance from the mine: the stage-2 homepage
  // measurement that found no Google reviews and no review widget on the
  // prospect's CURRENT site. Strict shape checks — an unmeasured record, a
  // malformed shape, or a gap set that does NOT include "reviews" emits no
  // key, so the email can never tell a business "your reviews never showed"
  // about a site the mine saw showing them. The composer adds its own second
  // gate (the verified review numbers must be present) before the line ships.
  const buildReadyBlob = plainObject(evidence.build_ready) || {};
  const qualificationBlob = plainObject(buildReadyBlob.qualification) || {};
  const gapRecord = plainObject(evidence.integration_gap)
    || plainObject(qualificationBlob.integration_gap)
    || null;
  if (gapRecord && gapRecord.measured === true && gapRecord.gap === true
    && Array.isArray(gapRecord.gaps) && gapRecord.gaps.includes("reviews")) {
    options.integrationGap = true;
  }

  // -- COMPLIANCE ----------------------------------------------------------
  // Both are hard send-gates in complianceFooter() before this is ever
  // called, so an absent value here means the send is already refused.
  set("postalAddress", cleanString(compliance.postal));
  set("unsubUrl", httpsOnly(compliance.unsubscribe));

  // -- RILEY ---------------------------------------------------------------
  // OUR agency line, resolved from the environment, with NO client bag passed
  // in. Handing resolveRileyLine the prospect's own facts would let it answer
  // with the PROSPECT's phone number, and the email would tell a business to
  // call Riley on their own line. Unset env resolves to null and the whole
  // free-call panel disappears — there is no literal fallback number, and
  // there must never be one again.
  const riley = resolveRileyLine({ allowAgencyLine: true, env });
  set("rileyPhone", riley && riley.phone ? riley.phone : "");

  // -- THE EXPIRY ----------------------------------------------------------
  // A REAL STORED TIMESTAMP OR NOTHING. This is the field the composer used to
  // invent: `expiryLabel(o.expiresAt || Date.now() + 7 * 864e5)` printed "we
  // keep your preview until <today+7>" as a commitment nobody recorded, on the
  // 44 of 45 rows that have no preview_expires_at. The composer's fallback is
  // gone; this only ever passes a timestamp that parses AND is still in the
  // future, because a preview "kept until" a date that has already passed
  // reads as a broken promise rather than a missing one.
  const expiresRaw = prospectRow.preview_expires_at ?? prospectRow.previewExpiresAt
    ?? evidence.preview_expires_at ?? evidence.previewExpiresAt;
  const expiresText = cleanString(expiresRaw);
  if (expiresText) {
    const parsed = new Date(expiresText);
    const nowMs = Number(typeof now === "function" ? now() : now);
    if (Number.isFinite(parsed.getTime())
      && Number.isFinite(nowMs)
      && parsed.getTime() > nowMs) {
      options.expiresAt = parsed.toISOString();
    }
  }

  // -- OPTIONAL SURFACES WITH NO WORKING SOURCE TODAY ----------------------
  // Each is accepted from a caller that has proven one, and is otherwise
  // absent. None of them is derived here, because deriving them would mean
  // guessing: there is no persisted animated hero on any row, /api/countdown
  // is not deployed, and prospectMagicLink()'s ONE-CLICK #t= LINK is still
  // rejected by production (401 bad_signature — prod signs with a secret
  // nothing outside it holds, re-measured 2026-08-11). What that same helper
  // DOES yield is a written access row and the PIN that opens it, which
  // production accepts today; that arrives below as `dashboardAccess`.
  const scanned = options.marketProvisional === true ? null : numOrNull(scannedCount);
  if (scanned !== null && scanned > 0) options.scannedCount = Math.round(scanned);
  set("connectMagicLink", httpsOnly(connectMagicLink));
  set("countdownGifUrl", httpsOnly(countdownGifUrl));
  // THE "TALK TO RILEY NOW" WEB-CALL LINK. Accepted only from a caller that has
  // a real VAPI web-voice embed URL; there is no source for one today, so this is
  // absent on every live send and the composer uses its own #chat / tel fallback.
  // https-only, so a junk or http value emits no key and never a dead button.
  set("talkToRileyUrl", httpsOnly(talkToRileyUrl));
  // Strict true only — the composer reads `=== true`, and a truthy string here
  // would silently render nothing while looking enabled at the call site.
  if (connectIncluded === true) options.connectIncluded = true;

  // -- THE DASHBOARD SIGN-IN -----------------------------------------------
  //
  // ONLY A PROVISIONED ROW EARNS THIS BLOCK, AND IT ARRIVES AS ONE OBJECT so
  // the three fields cannot be supplied apart. `provisioned: true` is the
  // caller's statement that lib/wss-connect-assets/magic-link.js completed a
  // live_upsert — the same gate that helper uses before it will return a link
  // — so a dry run, an unconfigured store or a failed write all arrive here as
  // provisioned:false and the whole door disappears.
  //
  // The email is NOT read off the prospect row here. It must be the address the
  // access row was actually written under, because that is the string
  // dashboard-login matches on (owner_email=eq.<email>); a second address on
  // the same business would print a sign-in that 401s.
  //
  // THE SIGN-IN ADDRESS IS THE PROSPECT'S, OR THE DOOR DOES NOT SHIP
  // (2026-08-16, after the Ron Steele sandbox send). That proof's dashboard
  // line read "sign in with woodwardsoftware@gmail.com" — the AGENCY OWNER's
  // address, CORRECT for a sandbox proof (internalOwnerProof rebinds the
  // recipient onto GHOST_AGENCY_OWNER_EMAIL and the access row follows) and
  // FATAL in a live send: a prospect told to "sign in with your email" would
  // be typing the agency's address into their own door. The distinction cannot
  // be derived from the data — "it happens to be the owner's address" is
  // exactly the state that must not pass unnoticed — so the caller states the
  // lane (`sandbox: true`), and the guard admits an address other than the
  // prospect's own ONLY on that flag, and then only the owner's, never a
  // third party's. A mismatch on the live lane removes the whole door
  // (fail closed, never block the send — the email ships with every other
  // block intact) rather than printing a sign-in the reader cannot use.
  //
  // The PIN is checked for shape (6 digits, what generatePin and the
  // deterministic recipes both produce) rather than trusted blind: a truncated
  // or empty PIN would render a card telling a real business to type something
  // that cannot work.
  const access = plainObject(dashboardAccess) || {};
  const accessEmail = cleanString(access.ownerEmail || access.owner_email).toLowerCase();
  const accessPin = cleanString(access.pin);
  // The prospect's own address, read with the same precedence lib/email.js's
  // prospectValue(["email", "ownerEmail", "owner_email"]) uses to pick the
  // recipient — so the guard compares the door against the same field that
  // chose who got the email. Light-normalised (mailto stripped, lowercased)
  // to match what normalizeEmail produced upstream without importing it.
  const prospectSigninEmail = cleanString(
    prospectRow.email ?? prospectRow.ownerEmail ?? prospectRow.owner_email,
  ).replace(/^mailto:/i, "").toLowerCase();
  const ownerSigninEmail = cleanString(env == null ? "" : env.GHOST_AGENCY_OWNER_EMAIL).toLowerCase();
  const signInTheDocument = accessEmail === prospectSigninEmail
    || (sandbox === true && ownerSigninEmail !== "" && accessEmail === ownerSigninEmail);
  if (access.provisioned === true && accessEmail.includes("@") && /^\d{6}$/.test(accessPin)) {
    const url = httpsOnly(access.dashboardUrl || access.dashboard_url);
    if (url && signInTheDocument) {
      options.dashboardUrl = url;
      options.dashboardEmail = accessEmail;
      options.dashboardPin = accessPin;
      // The one-tap auto-login link, when the provisioning minted one. https-only;
      // absent leaves the door on the email+PIN form. It rides on the same
      // provisioned gate as the pair because it grants the same access.
      const magic = httpsOnly(access.magicLink || access.magic_link);
      if (magic) options.dashboardMagicLink = magic;
    }
  }

  assertKnownProofEmailInputs(options);
  return options;
}

/**
 * The guard lib/outreach-email-v3.js does not have.
 *
 * composeOutreachEmailV3 reads its options off a bare object with no
 * allowlist, so a misspelled or retired name is accepted, dropped, and
 * rendered as an absent field — which looks exactly like a business with no
 * data. That is the 2026-07-31 `bodyText` defect, and it shipped every
 * follow-up as the wrong email for weeks. This boundary refuses instead.
 */
function assertKnownProofEmailInputs(options = {}) {
  const unknown = Object.keys(options).filter((key) => !PROOF_EMAIL_V3_OPTION_KEYS.includes(key));
  if (unknown.length) {
    throw new Error(
      `buildProofEmailInputs produced option(s) composeOutreachEmailV3 does not read: ${unknown.join(", ")}`,
    );
  }
  return options;
}

module.exports = {
  buildProofEmailInputs,
  proofEmailV3Enabled,
  assertKnownProofEmailInputs,
  PROOF_EMAIL_V3_OPTION_KEYS,
  PROOF_EMAIL_V3_OFF_VALUES,
  PLACEHOLDER_VALUES,
  // Approved standing config the composer imports and renders verbatim — see
  // the block comment above the constant. Exported so the composer can read it
  // and test/email-value-stack.test.js can pin the rows and the sums.
  VALUE_STACK,
};
