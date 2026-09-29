"use strict";

// lib/riley-update-email.js — the recurring "here's what I did for you" email
// FROM Riley TO the business owner, composed ONLY from lib/site-change-log.js.
//
// WHAT THIS SURFACE IS. Retention, not acquisition. The owner of WSS calls the
// target feel "taste and style and a good energetic vibration": the client
// should read it and feel a sharp assistant is genuinely working on their
// business. So the copy is Riley in the first person — "You asked: 'make the
// logo bigger' — done. It's live on your site." — never "the following
// modifications were deployed."
//
// THE TRUTH LAW, RESTATED FOR THIS FILE. Every sentence that claims something
// happened maps 1:1 to an entry in the site change log, and every entry in
// that log maps to a durable record (see lib/site-change-log.js — no default
// branch there emits text, so nothing reaches this file that is not a record).
// This module adds VOICE, never FACTS:
//
//   · one log entry -> exactly one claim row, in both MIME halves. N in, N out.
//   · a kind this file does not recognise renders the log's own sentence
//     verbatim — the record's words, not invented ones.
//   · each first-person template claims AT MOST what its kind's source record
//     supports. `rebuild` covers both "a new version was built" and "rebuilt
//     and republished", so its sentence says only the weaker truth. `failed`
//     rows claim nothing about the state of the site. Held rows may say "your
//     live page stayed put" because every held source records non-publication.
//   · empty change list -> NO EMAIL. Incomplete change log (a source read
//     failed) -> NO EMAIL: a digest that silently omits part of the story is
//     the same defect class as inventing one.
//   · counts in the subject and the leads line are counted off the claim list
//     itself, never estimated.
//
// THE RECIPIENT LOCK. While this surface is samples-only (owner has not
// approved the look), every send goes to the owner's own mailbox and nowhere
// else. The allowlist below is checked BEFORE anything is composed or read.
// When the owner approves and a cron is wired, the lock is where per-client
// delivery gets decided deliberately — it cannot be drifted into.
//
// THE LOOK. Palette, type ladder, card depth and the mark come from
// lib/wss-email-design.js — the email rendering of the WSS brand kit
// (packages/wss-brand-system; docs/design-board is the same brand's product
// surface). Same masthead lockup, same raised card, same signature rule as
// lib/riley-email-shell.js, so Riley's update and Riley's notes read as one
// company. Email-safe: tables + inline styles only, 680px fluid container,
// explicit foreground AND background on every element (that pairing is what
// survives dark-mode recoloring), no <style>, no @media, no flex/grid.
//
// NO CRON IS WIRED HERE, on purpose. sendRileyUpdateEmail is called by hand
// (see scripts/riley-update-email-sample.js) until the owner approves the look.

const design = require("./wss-email-design");
const { optOutPromiseHtml, OPT_OUT_PROMISE } = require("./opt-out-promise");
const { resolveRileyLine } = require("./riley-line");
const {
  RILEY_ROLE,
  RILEY_DISCLOSURE,
  WSS_IDENTITY,
  LEGAL_ENTITY,
} = require("./riley-email-shell");
const { clientReferenceCode } = require("./client-reference");
const { siteChangeLog: defaultSiteChangeLog } = require("./site-change-log");

const { FONT_STACK, PALETTE, TYPE } = design;

/**
 * The ONLY address this module will hand to the mailer while the surface is
 * samples-only. Owner-update mail goes to the owner; a prospect or customer
 * address is refused before any record is read.
 */
const RILEY_UPDATE_RECIPIENT = "woodwardsoftware@gmail.com";

/** The customer dashboard — the same URL the activation email prints. */
const DASHBOARD_URL = "https://wss-ai.com/dashboard";

/** Longest detail excerpt (a runner's sentence, a reason, a contact line). */
const MAX_DETAIL_CHARS = 160;

/** Gmail shows roughly this much preview text beside the subject. */
const PREHEADER_MAX_CHARS = 140;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function collapse(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function shorten(value, max) {
  const clean = collapse(value);
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * The customer's own instruction, as the change log quoted it inside the
 * entry sentence (lib/site-change-log.js wraps the excerpt in double quotes).
 * Returns the quoted words or "" — never a guess at what they asked.
 */
function quotedAsk(what) {
  const match = /"([^"]+)"/.exec(String(what || ""));
  return match ? match[1] : "";
}

// ---------------------------------------------------------------------------
// voice — one Riley sentence per recorded kind
// ---------------------------------------------------------------------------

/** Kinds that are Riley's own work on the site. Everything else people did. */
const WORK_KINDS = Object.freeze([
  "edit_done", "edit_in_progress", "edit_refused", "edit_failed",
  "rebuild", "rebuild_started", "checks_passed", "preview_published",
  "update_emailed", "rebuild_held", "rebuild_incomplete",
]);

const ACTIVITY_KINDS = Object.freeze([
  "lead_captured", "new_conversation", "assistant_replied",
  "preview_opened", "site_notice",
]);

/** work | activity. An unknown kind is reported as work, in the record's own words. */
function claimBucket(kind) {
  return ACTIVITY_KINDS.includes(String(kind || "")) ? "activity" : "work";
}

/**
 * rileyVoiceLine(entry) -> string. First person, warm, plain — and bounded by
 * what the entry's kind truthfully supports (the bound is documented per kind
 * in lib/site-change-log.js; templates here never claim past it).
 *
 * The default branch returns the LOG'S OWN SENTENCE, not invented copy: an
 * unrecognised kind still came from a durable record, and the truthful thing
 * this file can print for it is that record's sentence, verbatim.
 */
function rileyVoiceLine(entry = {}) {
  const kind = String(entry.kind || "");
  const what = String(entry.what || "");
  const ask = quotedAsk(what);
  switch (kind) {
    // -- her work -----------------------------------------------------------
    case "edit_done":
      // `done` is written only after the runner render-verified the change,
      // so "live" is safe here and ONLY here among the edit kinds.
      return ask
        ? `You asked: "${ask}" — done. It's live on your site.`
        : "A change you asked for is done — it's live on your site.";
    case "edit_in_progress":
      return ask
        ? `I've got your request — "${ask}" — and it's in the works.`
        : "I've got your latest request and it's in the works.";
    case "edit_refused":
      return ask
        ? `I held off on one request — "${ask}" — and left your site exactly as it was.`
        : "I held off on one request and left your site exactly as it was.";
    case "edit_failed":
      // Claims NOTHING about the state of the site — the record doesn't.
      return ask
        ? `One request — "${ask}" — didn't go through on my end. Ask me again and I'll take another run at it.`
        : "One request didn't go through on my end. Ask me again and I'll take another run at it.";
    case "rebuild":
      // Weakest common truth: this kind covers "a new version was built" AND
      // "rebuilt and republished", so it may not say "live" or "replaced".
      return "I built a fresh version of your site.";
    case "rebuild_started":
      return "I started a rebuild of your site.";
    case "checks_passed":
      return "I checked the new build on the real rendered page — it passed.";
    case "preview_published":
      return "I put the new version of your site up at its own web address — take a look.";
    case "update_emailed":
      return "I sent the email introducing your new site preview.";
    case "rebuild_held":
      // Every held source records non-publication, so "stayed put" is safe.
      return "A rebuild attempt got stopped by my checks before it could publish — your live page stayed put.";
    case "rebuild_incomplete":
      // May have stopped before OR after anything went live; claim neither.
      return "One build run stopped before finishing.";
    // -- their people -------------------------------------------------------
    case "lead_captured":
    case "new_conversation":
    case "site_notice":
      // Already composed for the owner by the change log, from the thread row
      // itself (who, via which channel, about what). Verbatim.
      return what;
    case "assistant_replied":
      return /captured/i.test(what)
        ? "Your website chat answered a visitor and captured their contact details."
        : "Your website chat answered a visitor.";
    case "preview_opened":
      return "Someone opened your site preview link.";
    default:
      return what; // the record's sentence — never a sentence of our own
  }
}

/** The proof-link label. "See it live" only where the kind shows a change. */
function proofLabel(kind) {
  return ["edit_done", "rebuild", "checks_passed", "preview_published", "update_emailed"]
    .includes(String(kind || ""))
    ? "see it live"
    : "your site";
}

/** Marker glyph + tone per kind — plain text glyphs, colored inline. */
function marker(kind, bucket) {
  const k = String(kind || "");
  if (k === "edit_done" || k === "checks_passed" || k === "preview_published" || k === "update_emailed") {
    return { glyph: "&#10003;", color: PALETTE.success };
  }
  if (k === "rebuild" || k === "rebuild_started") return { glyph: "&#8635;", color: PALETTE.accent };
  if (k === "edit_in_progress") return { glyph: "&#8230;", color: PALETTE.muted };
  if (k === "edit_failed") return { glyph: "!", color: PALETTE.danger };
  if (k === "edit_refused" || k === "rebuild_held" || k === "rebuild_incomplete") {
    return { glyph: "&#8211;", color: PALETTE.muted };
  }
  if (k === "lead_captured") return { glyph: "&#9733;", color: PALETTE.accent };
  if (bucket === "activity") return { glyph: "&#8226;", color: PALETTE.accent };
  return { glyph: "&#8226;", color: PALETTE.muted };
}

// ---------------------------------------------------------------------------
// the window, in words
// ---------------------------------------------------------------------------

const MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

/**
 * windowPhrases({ since, until }) -> { label, tag }
 *   label — mid-sentence ("this week", "in the last 24 hours", "since Aug 3")
 *   tag   — subject-line ("today", "this week", "since Aug 3")
 * An unparseable window yields EMPTY phrases and the sentences omit the
 * timeframe — omission over invention.
 */
function windowPhrases(window = {}) {
  const sinceMs = Date.parse(String(window.since || ""));
  const untilMs = Date.parse(String(window.until || ""));
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
    return { label: "", tag: "" };
  }
  const span = untilMs - sinceMs;
  if (span <= 26 * 60 * 60 * 1000) return { label: "in the last 24 hours", tag: "today" };
  if (span <= 8 * 24 * 60 * 60 * 1000) return { label: "this week", tag: "this week" };
  const since = new Date(sinceMs);
  const day = `since ${MONTHS[since.getUTCMonth()]} ${since.getUTCDate()}`;
  return { label: day, tag: day };
}

// ---------------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------------

/**
 * composeRileyUpdateEmail({ log, businessName, clientId, env })
 *   -> { ok:false, reason }                       — nothing send-worthy
 *   -> { ok:true, subject, html, text, claims, counts, meta }
 *
 * `log` is a lib/site-change-log.js result. Refusals, in order:
 *   change_log_unavailable — the log itself failed (or was not supplied)
 *   change_log_incomplete  — a source read failed; the list may be missing
 *                            items, and a digest must not under-report silently
 *   no_changes             — genuinely nothing happened; there is no email
 */
function composeRileyUpdateEmail({ log, businessName = "", clientId = "", env = process.env } = {}) {
  if (!log || log.ok !== true || !Array.isArray(log.entries)) {
    return { ok: false, reason: "change_log_unavailable", detail: log && log.reason ? String(log.reason) : "" };
  }
  if (log.complete !== true) {
    return { ok: false, reason: "change_log_incomplete", entries: log.entries.length };
  }
  if (log.entries.length === 0) {
    return { ok: false, reason: "no_changes" };
  }

  // ONE ENTRY -> ONE CLAIM. This map is the entire fact surface of the email.
  const claims = log.entries.map((entry) => ({
    kind: String(entry.kind || ""),
    bucket: claimBucket(entry.kind),
    text: collapse(rileyVoiceLine(entry)),
    detail: shorten(entry.detail, MAX_DETAIL_CHARS),
    proof: String(entry.proof || ""),
    at: String(entry.at || ""),
  }));
  const work = claims.filter((claim) => claim.bucket === "work");
  const activity = claims.filter((claim) => claim.bucket === "activity");
  const counts = {
    claims: claims.length,
    updates: work.length,
    leads: claims.filter((claim) => claim.kind === "lead_captured").length,
    conversations: claims.filter((claim) => claim.kind === "new_conversation").length,
    activity: activity.length,
  };
  const people = counts.leads + counts.conversations;
  const { label, tag } = windowPhrases(log.window);

  // Subject — counted off the claim list, never estimated.
  const subjectParts = [];
  if (counts.updates) subjectParts.push(`${counts.updates} update${counts.updates === 1 ? "" : "s"}`);
  if (counts.leads) subjectParts.push(`${counts.leads} new lead${counts.leads === 1 ? "" : "s"}`);
  if (!subjectParts.length && counts.conversations) {
    subjectParts.push(`${counts.conversations} new conversation${counts.conversations === 1 ? "" : "s"}`);
  }
  if (!subjectParts.length) subjectParts.push("new activity");
  const subject = `Riley — ${subjectParts.join(", ")} on your site${tag ? ` ${tag}` : ""}`;

  const name = collapse(businessName);
  const reference = collapse(clientId);
  const line = resolveRileyLine({ env, allowAgencyLine: true });
  const postal = collapse(env && env.GHOST_AGENCY_POSTAL_ADDRESS);
  const siteUrl = String(log.siteUrl || "");

  const greeting = name ? `Hi ${name} — it's Riley.` : "Hi — it's Riley.";
  const intro = counts.updates
    ? `Here's what I've been up to on your site${label ? ` ${label}` : ""} — each item links to the live page so you can check my work.`
    : `No site changes${label ? ` ${label}` : ""}, but there's been activity on your site — here it is.`;
  const peopleHeadline = people
    ? `${people === 1 ? "1 person" : `${people} people`} messaged your site${label ? ` ${label}` : ""} — the messages are in your inbox.`
    : (activity.length ? `A little activity on your site${label ? ` ${label}` : ""}:` : "");
  // ONE clear next step. "Call" only — the Riley line is voice, not SMS.
  const nextStep = `Reply to this email with the next thing you want changed${line.phone ? `, or call me at ${line.display}` : ""} — I'll take it from there.`;

  // ---- HTML ---------------------------------------------------------------

  const claimRow = (claim) => {
    const mark = marker(claim.kind, claim.bucket);
    const detailHtml = claim.detail
      ? `<p style="margin:4px 0 0;${TYPE.caption};word-break:break-word">${escapeHtml(claim.detail)}</p>`
      : "";
    const proofHtml = claim.proof
      ? ` <a href="${escapeHtml(claim.proof)}" style="color:${PALETTE.accent};text-decoration:none;font-weight:700;white-space:normal">${escapeHtml(proofLabel(claim.kind))} &#8594;</a>`
      : "";
    return `<tr data-claim="${escapeHtml(claim.kind)}">
        <td width="24" valign="top" style="width:24px;padding:7px 0;font-family:${FONT_STACK};font-size:15px;line-height:1.55;font-weight:800;color:${mark.color}">${mark.glyph}</td>
        <td valign="top" style="padding:7px 0;font-family:${FONT_STACK};font-size:14.5px;line-height:1.55;color:${PALETTE.ink};word-break:break-word">${escapeHtml(claim.text)}${proofHtml}${detailHtml}</td>
      </tr>`;
  };

  const workSection = work.length
    ? `${design.eyebrow("What changed", PALETTE.accent)}
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%">
        ${work.map(claimRow).join("\n        ")}
      </table>`
    : "";

  const accent = design.clientAccent("");
  const activitySection = activity.length
    ? `<tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${accent.tint};border:1px solid ${accent.tintLine};border-radius:14px">
      <tr><td style="padding:20px 24px 18px">
        ${design.eyebrow("People", accent.onLight)}
        ${peopleHeadline ? `<p style="margin:0 0 8px;${TYPE.subtitle}">${escapeHtml(peopleHeadline)}</p>` : ""}
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%">
          ${activity.map(claimRow).join("\n          ")}
        </table>
      </td></tr>
    </table>
  </td></tr>`
    : "";

  const phoneLine = line.phone
    ? `<p style="margin:10px 0 0;font-family:${FONT_STACK};font-size:13.5px;line-height:1.5;color:${PALETTE.ink}">&#128222; Call Riley: <a href="${escapeHtml(line.telHref)}" style="color:${PALETTE.accent};text-decoration:none;font-weight:700">${escapeHtml(line.display)}</a></p>`
    : "";
  const dashboardLine = `<p style="margin:6px 0 0;font-family:${FONT_STACK};font-size:13.5px;line-height:1.5;color:${PALETTE.ink}">Your dashboard: <a href="${DASHBOARD_URL}" style="color:${PALETTE.accent};text-decoration:none;font-weight:700">wss-ai.com/dashboard</a></p>`;
  const referenceLine = reference
    ? `<p style="margin:6px 0 0;${TYPE.caption}">Client ID: <span style="font-weight:800;color:${PALETTE.ink}">${escapeHtml(reference)}</span> — your login, and what you read to me when you call.</p>`
    : "";

  const footerIdentity = [escapeHtml(WSS_IDENTITY), escapeHtml(LEGAL_ENTITY), postal ? escapeHtml(postal) : ""]
    .filter(Boolean)
    .join(" &middot; ");

  const preheader = shorten(claims[0].text, PREHEADER_MAX_CHARS);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${PALETTE.page};font-family:${FONT_STACK}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${PALETTE.page}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" cellpadding="0" cellspacing="0" width="680" style="max-width:680px;width:100%">

  <!-- 1. MASTHEAD — same lockup as every WSS email -->
  <tr><td style="padding:0 6px 18px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle" style="padding-right:12px">
        <img src="${design.WSS_MARK_URL}" width="44" height="44" alt="WSS Labs" style="display:block;width:44px;height:44px;border:0;border-radius:12px">
      </td>
      <td valign="middle">
        <span style="font-family:${FONT_STACK};font-size:16px;font-weight:800;color:${PALETTE.ink};letter-spacing:-.01em">WSS Labs</span><br>
        <span style="font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${PALETTE.muted}">Riley &middot; ${escapeHtml(RILEY_ROLE)}</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- 2. THE UPDATE — greeting, what changed, proof links -->
  <tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle()}">
      <tr><td style="padding:5px 0 0;background:${PALETTE.accent};font-size:0;line-height:0;border-radius:13px 13px 0 0">&nbsp;</td></tr>
      <tr><td style="padding:26px 26px 22px">
        <h1 style="margin:0 0 8px;${TYPE.title}">${escapeHtml(greeting)}</h1>
        <p style="margin:0 0 ${work.length ? "16" : "4"}px;${TYPE.body}">${escapeHtml(intro)}</p>
        ${workSection}
      </td></tr>
    </table>
  </td></tr>

  <!-- 3. PEOPLE — only when people actually reached out -->
  ${activitySection}

  <!-- 4. ONE NEXT STEP -->
  <tr><td style="padding:2px 6px 18px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%"><tr>
      <td width="4" style="width:4px;background:${PALETTE.accent};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
      <td style="padding-left:14px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;font-weight:700;color:${PALETTE.ink}">${escapeHtml(nextStep)}</td>
    </tr></table>
  </td></tr>

  <!-- 5. SIGNATURE -->
  <tr><td style="padding:0 6px 0">
    <p style="margin:0;font-family:${FONT_STACK};font-size:17px;line-height:1.35;font-weight:800;color:${PALETTE.ink}">&mdash; Riley</p>
    <p style="margin:3px 0 0;${TYPE.caption}">${escapeHtml(RILEY_ROLE.replace(/^your /, ""))} &middot; WSS Labs</p>
    <p style="margin:8px 0 0;${TYPE.small}">${escapeHtml(RILEY_DISCLOSURE)}</p>
    ${phoneLine}
    ${dashboardLine}
    ${referenceLine}
  </td></tr>

  <!-- 6. FOOTER -->
  <tr><td style="padding:24px 6px 0">
    <div style="border-top:1px solid ${PALETTE.line};padding-top:18px">
      ${optOutPromiseHtml()}
      <p style="margin:0;font-family:${FONT_STACK};font-size:11.5px;line-height:1.6;color:${PALETTE.muted}">${footerIdentity}</p>
    </div>
  </td></tr>

</table></td></tr></table>
</body></html>
`;

  // ---- TEXT — the same message, same claims, same order -------------------

  const bullet = (claim) => [
    `• ${claim.text}${claim.detail ? ` (${claim.detail})` : ""}`,
    claim.proof ? `  ${claim.proof}` : "",
  ].filter(Boolean).join("\n");
  const stanza = (...lines) => lines.filter(Boolean).join("\n");
  const text = [
    stanza("WSS Labs", `Riley — ${RILEY_ROLE}`),
    greeting,
    intro,
    work.length ? stanza("What changed:", ...work.map(bullet)) : null,
    activity.length ? stanza(peopleHeadline || "People:", ...activity.map(bullet)) : null,
    `Next step: ${nextStep}`,
    stanza(
      "— Riley",
      `${RILEY_ROLE.replace(/^your /, "")} · WSS Labs`,
      RILEY_DISCLOSURE,
      line.phone ? `Call Riley: ${line.display}` : null,
      `Your dashboard: ${DASHBOARD_URL}`,
      reference ? `Client ID: ${reference} — your login, and what you read to me when you call.` : null,
    ),
    stanza(
      "--",
      WSS_IDENTITY,
      LEGAL_ENTITY,
      postal || null,
      OPT_OUT_PROMISE,
    ),
  ].filter(Boolean).join("\n\n");

  return {
    ok: true,
    subject,
    html,
    text,
    claims,
    counts,
    meta: {
      siteSlug: String(log.siteSlug || ""),
      siteUrl,
      window: log.window || null,
      windowLabel: label,
      businessName: name || null,
      clientId: reference || null,
      phone: line.phone,
      phoneSource: line.source,
      postal: postal || null,
    },
  };
}

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

/** Accepts arrays, {data:[...]} and {rows:[...]} — anything else is "no row". */
function firstRow(result) {
  const rows = Array.isArray(result) ? result
    : Array.isArray(result && result.data) ? result.data
      : Array.isArray(result && result.rows) ? result.rows : [];
  return rows[0] && typeof rows[0] === "object" ? rows[0] : null;
}

/**
 * The prospect row for this slug — the source of the business name and the
 * Client ID. Same two-step lookup lib/site-change-log.js uses (site_slug
 * first, then the row whose preview_url IS this site — many real rows are
 * keyed only that way). A failed read degrades to a name-less greeting and
 * NO Client ID; it never invents either, and it never blocks the email (the
 * claims do not depend on it).
 */
async function prospectRowFor(slug, siteUrl, select) {
  // Same column list lib/site-change-log.js selects — notably NO place_id:
  // ghost_agency_prospects has no such column and PostgREST fails the whole
  // read over it (observed live: the name silently vanished from the sample).
  const columns = "select=prospect_id,business_name,site_slug,preview_url,updated_at";
  try {
    const bySlug = firstRow(await select(
      "ghost_agency_prospects",
      `${columns}&site_slug=eq.${encodeURIComponent(slug)}&order=updated_at.desc&limit=1`,
    ));
    if (bySlug) return bySlug;
    if (!siteUrl) return null;
    return firstRow(await select(
      "ghost_agency_prospects",
      `${columns}&preview_url=eq.${encodeURIComponent(siteUrl)}&order=updated_at.desc&limit=1`,
    ));
  } catch {
    return null;
  }
}

/**
 * sendRileyUpdateEmail(options, deps) — compose the update for one slug and
 * one window, and send it through the existing Resend path.
 *
 * options:
 *   siteSlug            required
 *   since/until/windowMs  the change-log window (default: last 24h)
 *   to                  optional; MUST equal RILEY_UPDATE_RECIPIENT (the lock)
 *   dryRun              compose only — returns the rendered email, sends nothing
 *   idempotencyKey      optional passthrough; none by default (samples lane —
 *                       a re-sent sample is a feature, not a dupe)
 *
 * deps (all injectable for tests): siteChangeLog, select, sendResendEmail, now.
 *
 * Refuses, in this order and with the sender untouched:
 *   recipient_not_allowed / change_log_* / no_changes  (see compose)
 */
async function sendRileyUpdateEmail(options = {}, deps = {}) {
  // THE LOCK FIRST. Before any read, any compose, any provider call.
  const to = String(options.to || RILEY_UPDATE_RECIPIENT).trim().toLowerCase();
  if (to !== RILEY_UPDATE_RECIPIENT) {
    return {
      ok: false,
      blocked: "recipient_not_allowed",
      message: `Riley update mail is samples-only and goes to ${RILEY_UPDATE_RECIPIENT} — nowhere else.`,
    };
  }

  const changeLog = typeof deps.siteChangeLog === "function" ? deps.siteChangeLog : defaultSiteChangeLog;
  const select = typeof deps.select === "function" ? deps.select : require("./store").select;

  const log = await changeLog({
    siteSlug: options.siteSlug,
    since: options.since,
    until: options.until,
    windowMs: options.windowMs,
    now: typeof deps.now === "function" ? deps.now() : deps.now,
    select,
  });

  const prospect = log && log.ok === true
    ? await prospectRowFor(log.siteSlug, String(log.siteUrl || ""), select)
    : null;
  const composed = composeRileyUpdateEmail({
    log,
    businessName: prospect ? String(prospect.business_name || "").trim() : "",
    clientId: prospect ? clientReferenceCode(prospect) : "",
    env: deps.env || process.env,
  });
  if (!composed.ok) {
    return {
      ok: false,
      blocked: composed.reason,
      detail: composed.detail || undefined,
      entries: log && Array.isArray(log.entries) ? log.entries.length : 0,
      complete: Boolean(log && log.complete === true),
      window: (log && log.window) || null,
    };
  }

  if (options.dryRun === true) {
    return {
      ok: true,
      mode: "composed",
      to,
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
      claims: composed.counts.claims,
      counts: composed.counts,
      meta: composed.meta,
    };
  }

  const send = typeof deps.sendResendEmail === "function"
    ? deps.sendResendEmail
    : require("./email").sendResendEmail; // lazy — keeps this module light to load
  const result = await send({
    to,
    cc: [],
    bcc: [],
    senderKind: "transactional",
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    ...(options.idempotencyKey ? { idempotencyKey: String(options.idempotencyKey) } : {}),
  });
  if (!result || result.mode !== "sent") {
    return {
      ok: false,
      blocked: result && result.mode === "dry_run" ? "resend_not_configured" : "send_failed",
      result: result || null,
      subject: composed.subject,
    };
  }
  return {
    ok: true,
    mode: "sent",
    id: result.id,
    to,
    subject: composed.subject,
    claims: composed.counts.claims,
    counts: composed.counts,
    window: composed.meta.window,
  };
}

module.exports = {
  DASHBOARD_URL,
  RILEY_UPDATE_RECIPIENT,
  claimBucket,
  composeRileyUpdateEmail,
  rileyVoiceLine,
  sendRileyUpdateEmail,
  windowPhrases,
};
