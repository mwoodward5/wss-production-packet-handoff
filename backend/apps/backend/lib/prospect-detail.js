"use strict";

const { boundedDetailText } = require("./detail-text");

/**
 * WHAT WE ALREADY KNOW ABOUT ONE BUSINESS, IN WORDS A HUMAN READS.
 *
 * The miner has been writing a lot per lead for months and almost none of it
 * ever reached a screen. Measured against the real table on 2026-08-11
 * (1,333 rows; 198 of them not archived — the set an operator actually works):
 *
 *     email address        198/198      their own website     198/198
 *     phone                196/198      street address        195/198
 *     star rating          182/198      review count          182/198
 *     why we picked them   184/198      what's wrong w/ site  173/198
 *     opening hours        135/198      social profiles       107/198
 *     a mirror we built     80/198      a report link          20/198
 *     A CONTACT PERSON       0/198      a service list          0/198
 *
 * So the drawer is not short of material — the gallery was simply throwing it
 * away. Two fields are genuinely empty everywhere and the UI says so out loud
 * rather than rendering a blank: nobody's NAME is ever captured, and the newer
 * mining lane stopped writing a service list.
 *
 * This module is pure. It takes rows and returns display text. Every reader
 * below is a LIST of places the same truth has lived across pipeline
 * generations, tried in order, because a value that moved is still a value we
 * have. Nothing here invents: a field with no source anywhere comes back empty
 * and carries its own plain-English reason.
 */

// Both are pure given their inputs; env always arrives as a parameter so this
// module stays deterministic under test.
const { resolveRileyLine } = require("./riley-line");
const { clientReferenceCode } = require("./client-reference");

const PLAIN_STATUS = Object.freeze({
  new: "Just found — nothing built yet",
  packeted: "Research done, waiting to be built",
  // These are POST-build Line states. `line_queued` means the mirror already
  // passed the render gate and its outreach draft is waiting behind the
  // operator's explicit batch approval; it never meant "waiting to be built".
  line_queued: "Built and gated — waiting for batch approval",
  line_gate_passed: "Built — render gate passed",
  held: "Held back for a second look",
  archived_legacy: "Old record, parked",
  completed: "Finished",
  do_not_contact: "Do not contact",
  unsubscribed: "Unsubscribed",
});

const PLAIN_TIER = Object.freeze({
  A: "Top pick",
  B: "Good fit",
  C: "Maybe",
  D: "Weak fit",
});

const PLAIN_LANE = Object.freeze({
  email: "Best reached by email",
  call_or_sms: "Best reached by phone or text",
});

const PLAIN_HOLD = Object.freeze({
  email_confidence_below_threshold: "We are not confident enough in this email address",
  email_reachability_unverified: "Nobody has confirmed this email address accepts mail",
  owner_identity_unverified: "We do not know whose address this is",
  no_contact_evidence: "No contact details were found at all",
  leadminer_mirror_ready_human_review: "Flagged for a human to look at before anything goes out",
});

/**
 * The event type api/admin/send-mirror-proof.js writes after a proof lands.
 *
 * Owner proofs are excluded from ghost_agency_email_log by design, so this is
 * the ONLY record that one was ever sent. Both the drawer history and the
 * gallery card's "you already sent yourself this" line read it.
 */
const PROOF_SENT_EVENT_TYPE = "operator.mirror_proof_sent";

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function at(source, path) {
  return path.split(".").reduce(
    (node, key) => (node && typeof node === "object" ? node[key] : undefined),
    source,
  );
}

/** The first path that holds something real. Order is oldest-wins-last. */
function pick(source, paths) {
  for (const path of paths) {
    const value = at(source, path);
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && !value.length) continue;
    if (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) continue;
    return value;
  }
  return undefined;
}

function pickText(source, paths) {
  return text(pick(source, paths));
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function httpsUrl(value) {
  const raw = text(value);
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw;
}

function sentenceCase(value) {
  const raw = text(value);
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function humanize(value) {
  const raw = text(value);
  if (!raw) return "";
  return sentenceCase(raw.replace(/[_-]+/g, " "));
}

function firstText(...values) {
  for (const value of values) {
    const clean = text(value);
    if (clean) return clean;
  }
  return "";
}

function firstFailureText(...values) {
  for (const value of values) {
    const clean = boundedDetailText(value).trim();
    if (clean) return clean;
  }
  return "";
}

function firstTimestamp(...values) {
  for (const value of values) {
    const clean = text(value);
    if (clean && Number.isFinite(Date.parse(clean))) return clean;
  }
  return "";
}

// Only statuses whose production writers themselves prove the build boundary:
// writePreviewUrl writes line_gate_passed only after a sanitized URL passed the
// render gate, and queueEmail can write line_queued only from that exact state
// with that exact URL. Research (`packeted`) and legacy lifecycle words do not
// belong here merely because they may coexist with a retained preview URL.
const PROVEN_LINE_POST_BUILD_STATUSES = new Set([
  "line_gate_passed",
  "line_queued",
]);

/**
 * One build problem, with the timestamp from the SAME object.
 *
 * A reason and a timestamp used to be picked independently. If
 * last_build_error had only an `at` while build_dispatch held the actual error,
 * the drawer paired two unrelated facts. Keep each candidate atomic, then
 * compare that candidate with the current post-build row only after selection.
 */
function buildProblemOf(row = {}) {
  const { record } = flatten(row);
  const last = record.last_build_error && typeof record.last_build_error === "object"
    ? record.last_build_error
    : {};
  const dispatch = record.build_dispatch && typeof record.build_dispatch === "object"
    ? record.build_dispatch
    : {};
  const candidates = [
    {
      source: "last_build_error",
      reason: firstFailureText(last.reason, last.message),
      at: firstTimestamp(last.at),
    },
    {
      source: "build_dispatch",
      reason: firstFailureText(dispatch.reason, dispatch.error),
      at: firstTimestamp(dispatch.failed_at, dispatch.updatedAt, dispatch.updated_at),
    },
    {
      source: "blocked_reason",
      reason: text(record.blocked_reason),
      at: "",
    },
  ];
  const problem = candidates.find((candidate) => candidate.reason) || { source: "", reason: "", at: "" };
  const status = text(row.status || record.status).toLowerCase();
  const mirrorUrl = httpsUrl(row.preview_url || record.preview_url);
  const retainedLineBuildState = Boolean(mirrorUrl)
    && PROVEN_LINE_POST_BUILD_STATUSES.has(status);

  return {
    reason: problem.reason,
    at: problem.at,
    source: problem.source,
    state: problem.reason
      ? (retainedLineBuildState ? "site_present_with_unresolved_build_problem" : "current_or_unsequenced")
      : "none",
  };
}

/**
 * A prospect row flattened the way the rest of the codebase reads it: column
 * values win over the JSON blob, because a pipeline step can update a column
 * and leave `record` stale.
 */
function flatten(row = {}) {
  const record = row.record && typeof row.record === "object" && !Array.isArray(row.record) ? row.record : {};
  return { record, row };
}

function contactOf(row) {
  const { record } = flatten(row);
  const facts = at(record, "build_ready.mirror_request.facts") || {};
  const content = at(record, "build_ready.mirror_request.content") || {};
  const source = { row, record, facts, content };

  const socials = list(pick(source, ["facts.socials", "record.socials"]))
    .map((entry) => ({
      label: text(entry && (entry.label || entry.network)) || "Profile",
      url: httpsUrl(entry && entry.url),
    }))
    .filter((entry) => entry.url);

  const hours = list(pick(source, ["content.hours", "record.hours"]))
    .map((entry) => ({
      day: sentenceCase(text(entry && entry.day)),
      text: text(entry && (entry.text || entry.hours)),
    }))
    .filter((entry) => entry.day && entry.text);

  return {
    // Measured 0/198 on live rows. The UI must say "we never captured a name"
    // rather than render an empty line that reads like a bug.
    person: pickText(source, [
      "row.owner_name",
      "record.owner_name",
      "record.contact_enrichment.recommended_fields.owner_name",
      "record.identity.owner_name",
    ]),
    phone: pickText(source, ["row.phone", "record.phone", "facts.phone", "record.identity.phone"]),
    email: pickText(source, [
      "row.email",
      "row.owner_email",
      "record.email",
      "record.ownerEmail",
      "record.owner_email",
      "facts.email",
    ]),
    address: pickText(source, ["record.address", "facts.address", "record.identity.address"]),
    city: pickText(source, ["row.city", "record.city", "facts.city"]),
    state: pickText(source, ["row.state", "record.state", "facts.state"]),
    theirWebsite: httpsUrl(pick(source, [
      "row.current_website",
      "record.current_website",
      "record.website",
      "facts.current_website",
      "record.build_ready.discovery.url",
    ])),
    googleListing: httpsUrl(pick(source, ["facts.profile_url", "record.gbp_url"])),
    socials,
    hours,
  };
}

function reputationOf(row) {
  const { record } = flatten(row);
  const facts = at(record, "build_ready.mirror_request.facts") || {};
  const source = { record, facts };
  const rating = Number(pick(source, ["record.rating", "facts.rating"]));
  const reviewCount = Number(pick(source, ["record.review_count", "facts.review_count"]));
  const hasRating = Number.isFinite(rating) && rating > 0;
  const hasCount = Number.isFinite(reviewCount) && reviewCount > 0;

  let sentence = "No Google rating on file.";
  if (hasRating && hasCount) {
    sentence = `${rating.toFixed(1)} stars from ${reviewCount.toLocaleString()} Google reviews.`;
  } else if (hasRating) {
    sentence = `${rating.toFixed(1)} stars on Google.`;
  } else if (hasCount) {
    sentence = `${reviewCount.toLocaleString()} Google reviews, no star average on file.`;
  }

  return {
    rating: hasRating ? Number(rating.toFixed(1)) : null,
    reviewCount: hasCount ? reviewCount : null,
    sentence,
  };
}

/** WHY THIS ONE. The miner's own scoring, in its own words. */
function pickReasonOf(row) {
  const { record } = flatten(row);
  const opportunity = record.opportunity && typeof record.opportunity === "object" ? record.opportunity : {};
  const tier = text(opportunity.tier).toUpperCase();
  const score = Number(opportunity.score);
  const lane = text(opportunity.lane);

  return {
    tier: tier || "",
    tierPlain: PLAIN_TIER[tier] || (tier ? `Tier ${tier}` : ""),
    score: Number.isFinite(score) ? Math.round(score) : null,
    lane,
    lanePlain: PLAIN_LANE[lane] || humanize(lane),
    reasons: list(opportunity.reasons).map(text).filter(Boolean),
    disqualifiers: list(opportunity.disqualifiers).map(text).filter(Boolean),
    minerScore: Number.isFinite(Number(record.leadminer_score)) ? Number(record.leadminer_score) : null,
  };
}

/** A graded axis is {grade,score}; older rows stored a bare letter. Take both. */
function gradeOf(node) {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const score = Number(node.score);
    return {
      grade: text(node.grade),
      score: Number.isFinite(score) ? Math.round(score) : null,
    };
  }
  return { grade: text(node), score: null };
}

/** WHAT IS WRONG WITH THE SITE THEY HAVE. The probe already wrote sentences. */
function siteProblemsOf(row) {
  const { record } = flatten(row);
  const probe = record.website_probe && typeof record.website_probe === "object"
    ? record.website_probe
    : at(record, "build_ready.qualification.probe") || {};
  const qualification = at(record, "build_ready.qualification") || {};

  const signals = list(probe.signals).map(text).filter(Boolean);
  const loadMs = Number(probe.loadMs);

  return {
    signals,
    builder: text(probe.builder),
    loadMs: Number.isFinite(loadMs) && loadMs > 0 ? loadMs : null,
    reachable: probe.exists === true,
    mobileReady: probe.mobile === true,
    secure: probe.https === true,
    thin: probe.thin === true,
    wordCount: Number.isFinite(Number(probe.wordCount)) ? Number(probe.wordCount) : null,
    // The grader's own verdict, kept exactly as measured. Both axes are
    // objects — {grade,score} — on all 184 graded rows. Grading gates are off
    // (website_ceiling reads "off"), so these are information for the operator,
    // never a refusal, and the drawer must not present them as one.
    websiteGrade: gradeOf(qualification.website_axis),
    overallGrade: gradeOf(qualification.composite_signal),
    gradeNotes: list(qualification.reasons).map(text).filter(Boolean),
  };
}

/** WHAT WE HAVE BUILT FOR THEM SO FAR. */
function ourWorkOf(row) {
  const { record } = flatten(row);
  const source = { row, record };
  const dispatch = record.build_dispatch && typeof record.build_dispatch === "object" ? record.build_dispatch : {};
  const forgeJob = record.forge_job && typeof record.forge_job === "object" ? record.forge_job : {};
  const problem = buildProblemOf(row);

  return {
    mirrorUrl: httpsUrl(pick(source, ["row.preview_url", "record.preview_url"])),
    reportUrl: httpsUrl(pick(source, ["row.report_url", "record.report_url"])),
    donor: pickText(source, ["record.build_ready.donor", "record.build_ready.mirror_request.donor"]),
    logoUrl: httpsUrl(pick(source, [
      "record.build_ready.brand_evidence.logo_url",
      "record.build_ready.mirror_request.brand.logo",
      "record.logo_url",
    ])),
    accent: pickText(source, [
      "record.build_ready.brand_evidence.accent",
      "record.build_ready.mirror_request.brand.accent",
      "record.logo_accent",
    ]),
    lastCheckedAt: pickText(source, ["record.build_ready.proof.dry_run_at"]),
    // A failure the operator should see, not a code word.
    // The drawer was printing the literal words "Last problem recorded:
    // [object Object]". lib/line-adapters.js writes last_build_error as
    // {reason, at} and always has, so the path has to reach .reason — the
    // bare object stringifies to nothing an operator can read, and there is
    // no older shape of this field to fall back to.
    problem: problem.reason,
    problemAt: problem.at,
    problemSource: problem.source,
    problemState: problem.state,
    stage: text(forgeJob.stage) || (dispatch.pending === true ? "waiting" : ""),
  };
}

/** Reasons this lead is currently held out of outreach, said plainly. */
function holdsOf(row) {
  const { record } = flatten(row);
  const reasons = list(record.outreach_hold_reasons).map(text).filter(Boolean);
  return reasons.map((reason) => ({
    code: reason,
    plain: PLAIN_HOLD[reason] || humanize(reason),
  }));
}

/**
 * WHAT HAS ACTUALLY HAPPENED, newest first.
 *
 * Only measured events: rows in the send log, and build timestamps the
 * pipeline itself stamped. Nothing is inferred from a status string.
 */
function historyOf(row, { emailLogRows = [], noteRows = [], proofEventRows = [] } = {}) {
  const { record } = flatten(row);
  const entries = [];

  for (const entry of list(emailLogRows)) {
    const payload = entry && typeof entry.payload === "object" ? entry.payload : {};
    const ownerOnly = payload.ownerProof === true || payload.deliveryLane === "owner_only_proof";
    entries.push({
      kind: "email",
      when: text(entry && entry.sent_at),
      what: ownerOnly ? "Proof email sent to you" : "Email sent to the business",
      detail: text(payload.subject),
      ownerOnly,
    });
  }

  // Proof sends live in their own event channel because lib/email.js keeps them
  // out of the campaign log on purpose. Without this loop the drawer said
  // "Nothing has been sent or built for this business yet" about a business the
  // operator had just emailed himself.
  //
  // Since durable owner-proof accounting (2026-09-03) a proof send can arrive
  // through BOTH channels — the marked email_log row and the proof event.
  // One send is one history line: a proof event within a minute of an
  // owner-proof email_log row is the same delivery, not a second one.
  const ownerProofSendTimes = list(emailLogRows)
    .filter((entry) => entry && (entry.payload || {}).ownerProof === true)
    .map((entry) => Date.parse(text(entry && entry.sent_at)))
    .filter((time) => Number.isFinite(time));
  for (const entry of list(proofEventRows)) {
    const payload = entry && typeof entry.payload === "object" ? entry.payload : {};
    const when = text(entry && entry.created_at) || text(payload.at);
    if (!when) continue;
    const time = Date.parse(when);
    if (Number.isFinite(time) && ownerProofSendTimes.some((sendTime) => Math.abs(sendTime - time) <= 60_000)) continue;
    entries.push({
      kind: "email",
      when,
      what: "Proof email sent to you",
      detail: text(payload.recipient),
      ownerOnly: true,
    });
  }

  const builtAt = text(at(record, "build_ready.proof.dry_run_at"));
  if (builtAt) {
    entries.push({ kind: "build", when: builtAt, what: "Site checked and ready to build", detail: text(at(record, "build_ready.donor")) });
  }
  const forgeUpdated = text(at(record, "forge_job.updatedAt"));
  if (forgeUpdated) {
    entries.push({ kind: "build", when: forgeUpdated, what: "Build ran", detail: humanize(at(record, "forge_job.stage")) });
  }
  const archivedAt = text(record.archived_at);
  if (archivedAt) {
    entries.push({ kind: "status", when: archivedAt, what: "Parked", detail: humanize(record.archived_reason) });
  }

  for (const note of list(noteRows)) {
    entries.push({
      kind: "note",
      when: text(note && note.when),
      what: "Note added",
      detail: text(note && note.text).slice(0, 140),
    });
  }

  return entries
    .filter((entry) => entry.when)
    .sort((left, right) => Date.parse(right.when) - Date.parse(left.when));
}

function notesFromEvents(rows = []) {
  return list(rows)
    .map((row) => {
      const payload = row && typeof row.payload === "object" ? row.payload : {};
      return {
        when: text(row && row.created_at) || text(payload.at),
        who: text(payload.actor) || "Operator",
        text: text(payload.note),
      };
    })
    .filter((note) => note.text)
    .sort((left, right) => Date.parse(right.when) - Date.parse(left.when));
}

/**
 * WHERE AN EMAIL FROM THIS DRAWER WOULD ACTUALLY GO.
 *
 * The button in the gallery drives /api/admin/send-mirror-proof, which passes
 * internalOwnerProof:true. In lib/email.js that is not a softer send of the
 * same message — the recipient is REPLACED with GHOST_AGENCY_OWNER_EMAIL, cc
 * and bcc are forced empty, and a second assertion refuses the send outright
 * unless the resolved recipient already equals the configured owner
 * (`owner_proof_recipient_gate_failed`). There is no argument this drawer can
 * pass that reaches a business.
 *
 * So this function does not decide anything. It reports the same facts the
 * send path will act on, in advance, so the operator reads the destination
 * BEFORE pressing rather than discovering it in his inbox.
 */
/**
 * WHERE EVERY EMAIL THIS OPERATOR UI CAN SEND ACTUALLY GOES — one sentence,
 * one address, shared by the drawer and the gallery so the two surfaces cannot
 * drift into saying different things about the same route.
 *
 * There is exactly one send route reachable from /gallery
 * (/api/admin/send-mirror-proof) and it hard-codes internalOwnerProof:true.
 * This is therefore a statement of fact about that route, not a setting the
 * page consults and could get wrong.
 */
function ownerProofRouting(env = process.env) {
  const owner = text(env.GHOST_AGENCY_OWNER_EMAIL);
  return {
    recipient: owner,
    canSend: Boolean(owner),
    headline: owner
      ? `Every email on this page goes to ${owner} — your own inbox. The business is never emailed.`
      : "Nothing can be sent from here: no owner inbox is configured.",
  };
}

function sendRouting({ contactEmail = "", env = process.env, deliveryPauseActive = false, lastProofSentAt = "" } = {}) {
  const owner = text(env.GHOST_AGENCY_OWNER_EMAIL);
  const liveSendsOn = /^(1|true|yes|on)$/i.test(text(env.GHOST_AGENCY_PROSPECT_SEND_ENABLED));
  const reviewHold = /^(1|true|yes|on)$/i.test(text(env.GHOST_AGENCY_REVIEW_HOLD));

  const reasons = [];
  if (!liveSendsOn) reasons.push("Live sending to businesses is switched off");
  if (deliveryPauseActive) reasons.push("Outreach is paused");
  if (reviewHold) reasons.push("Everything is held for review");

  return {
    // Always the owner. Stated as a fact, not a setting.
    recipient: owner,
    recipientIsOwner: true,
    businessEmail: text(contactEmail),
    canSend: Boolean(owner),
    blockedReason: owner ? "" : "No owner inbox is configured, so nothing can be sent.",
    liveSendsOn,
    deliveryPauseActive: Boolean(deliveryPauseActive),
    reviewHold,
    reasons,
    // Empty until a proof has actually landed for this business. It is read
    // from the operator event channel, so it is a record of a send that
    // happened — never an assumption from a status string.
    lastProofSentAt: text(lastProofSentAt),
    headline: owner
      ? `This goes to your inbox — ${owner}. The business is not emailed.`
      : "Nothing can be sent: no owner inbox is configured.",
  };
}

/**
 * THE OPERATOR'S TEST-RILEY FACTS for one business — everything the drawer
 * needs to let the owner spot-check this client's Riley in one click, and
 * nothing invented:
 *
 *   · phone/telHref — the agency Riley line, resolved through lib/riley-line.js
 *     with allowAgencyLine:true. This is the operator's own console, the one
 *     surface that IS the agency, so the agency fallback is legitimate here.
 *     No line configured -> no phone, and the drawer says which env is unset.
 *   · clientId — the derived WSS-XXXXXX code (lib/client-reference.js), the
 *     exact string the owner reads to Riley to be recognised as this business.
 *   · chatUrl — the mirror with "#chat" appended so the site chat bubble is
 *     asked to open on arrival. Only offered when a mirror URL exists.
 */
function testRileyOf(row, env = process.env) {
  const { record } = flatten(row);
  const riley = resolveRileyLine({ client: row, facts: record, env, allowAgencyLine: true }) || {};
  const mirrorUrl = ourWorkOf(row).mirrorUrl;
  return {
    phone: text(riley.phone),
    display: text(riley.display),
    telHref: text(riley.telHref),
    phoneReason: riley.phone ? "" : text(riley.reason),
    clientId: clientReferenceCode(row),
    chatUrl: mirrorUrl ? `${mirrorUrl}${mirrorUrl.includes("#") ? "" : "#chat"}` : "",
  };
}

/**
 * Is this ghost_agency_email_log row an owner-proof delivery (the email went
 * to the operator's own inbox, never to the business)?
 *
 * One predicate, many readers: ledger-data, morning-report and console-data
 * already exclude owner-proof rows from campaign truth, and lib/email.js now
 * writes owner-proof rows (marked with exactly these payload fields) so every
 * real send is durably accounted. Dedup and drip-progression readers
 * (full-run's emailLogExists, run-campaign's nextStep, the Gallery's
 * last-send index) must use it too: a proof send to the OWNER is not proof
 * the BUSINESS was contacted.
 */
function isOwnerProofEmailRecord(row = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const lane = String(
    payload.deliveryLane || payload.delivery_lane || row.deliveryLane || row.delivery_lane || "",
  ).toLowerCase();
  return row.ownerProof === true
    || row.owner_proof === true
    || row.sandbox === true
    || payload.ownerProof === true
    || payload.owner_proof === true
    || payload.sandbox === true
    || payload.isProspectSend === false
    || payload.is_prospect_send === false
    || ["owner_only_proof", "owner-only", "owner_proof", "sandbox"].includes(lane);
}

/** Everything the drawer renders, for one business. */
function prospectDetail(row = {}, { emailLogRows = [], noteEventRows = [], proofEventRows = [], sendEnv = process.env, deliveryPauseActive = false } = {}) {
  const { record } = flatten(row);
  const contact = contactOf(row);
  const notes = notesFromEvents(noteEventRows);
  const status = text(row.status || record.status);
  const lastProofSentAt = list(proofEventRows)
    .map((entry) => text(entry && entry.created_at)
      || text(entry && entry.payload && entry.payload.at))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || "";

  return {
    prospectId: text(row.prospect_id || record.prospect_id),
    businessName: text(row.business_name || record.business_name || record.businessName) || "Unnamed business",
    vertical: humanize(text(row.industry || record.industry || record.vertical)),
    status,
    statusPlain: PLAIN_STATUS[status] || humanize(status) || "Status not set",
    firstSeen: text(row.created_at || record.created_at),
    lastTouched: text(row.updated_at || record.updated_at),
    contact,
    reputation: reputationOf(row),
    pick: pickReasonOf(row),
    siteProblems: siteProblemsOf(row),
    ourWork: ourWorkOf(row),
    holds: holdsOf(row),
    notes,
    history: historyOf(row, { emailLogRows, noteRows: notes, proofEventRows }),
    send: sendRouting({ contactEmail: contact.email, env: sendEnv, deliveryPauseActive, lastProofSentAt }),
    testRiley: testRileyOf(row, sendEnv),
  };
}

module.exports = {
  PLAIN_HOLD,
  PLAIN_LANE,
  PLAIN_STATUS,
  PLAIN_TIER,
  PROOF_SENT_EVENT_TYPE,
  contactOf,
  historyOf,
  isOwnerProofEmailRecord,
  notesFromEvents,
  ourWorkOf,
  ownerProofRouting,
  pickReasonOf,
  prospectDetail,
  reputationOf,
  sendRouting,
  siteProblemsOf,
  testRileyOf,
};
