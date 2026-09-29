"use strict";

// lib/riley-followups.js — the machinery behind the promises Riley makes out
// loud on a live call.
//
// THE DEFECT THIS FILE ENDS. Across 17 measured production calls, Riley said
// "you'll get 1 email when it's live" — and nothing mechanized it. The only
// completion email was notifyOwner() in lib/edit-job-runner.js, and it goes to
// the OWNER's inbox, never to the caller who was promised it. The promise was
// phantom. This module makes it a durable row with a consent gate, and keeps it
// at the exact moment it can honestly be kept: the edit job's terminal `done`
// write, which only lands after the rendered page verified the change.
//
// THE THREE-PART FLOW (voice call -> job terminal -> customer email):
//   1. Mid-call, Riley commits ("I'll email you when it's live"). The site-edit
//      lane records that commit BEFORE hanging up:
//        recordFollowUpPromise({ jobId, callId, siteSlug, consentEmail: true,
//                                consentSource: "verbal_call" })
//      — one call with the jobId it just enqueued — or sets the job row's
//      `follow_up` jsonb at insert (true, or { promise_kind, consent_email,
//      consent_source }). Both land in riley_followup_promises.
//   2. lib/edit-job-runner.js reaches its terminal write. On status "done" only
//      (a refusal or a failure must NEVER produce a "it's live" email), the
//      runner calls deliverFollowUp({ jobId, ... }).
//   3. deliverFollowUp resolves the client record by the job's site_slug, takes
//      the recipient ONLY from that record (never from anything said on the
//      call), checks consent, checks the suppression ledger, and only then
//      composes and sends. Every refusal writes its reason on the row, so the
//      audit trail shows exactly why a promised email did or did not go.
//
// THE CONSENT LAW. No consent record -> NO customer email. The owner rail
// (notifyOwner) is untouched and remains the only send in that case; the
// promise row records refused_no_consent. Consent is a boolean on the durable
// promise, set by the lane that heard it — never inferred, never defaulted on.
//
// THE RECIPIENT LAW. The recipient is the email ON THE CLIENT RECORD
// (ghost_agency_prospects.email, falling back to owner_email), resolved by
// site_slug. A voice model never supplies the address — the same open-relay
// doctrine as api/vapi-tools/send-note.js. If the record has no address, the
// send is refused and the refusal is recorded; nothing is "resolved" by guess.
//
// THE OWNER DIGEST STAYS LOCKED. lib/riley-update-email.js is samples-only by
// design and its RILEY_UPDATE_RECIPIENT lock is NOT unlocked here. The
// customer-rail composer below reuses the same rendering machinery (the WSS
// email design system, Riley's line, the opt-out promise, the disclosure) but
// is a separate function with its own gates, so the owner digest's recipient
// lock cannot drift.
//
// THE TRUTH LAW, FOR THIS FILE. composeCustomerLiveEmail refuses to compose
// unless the job row in hand is status "done" — the runner's guarantee that the
// change was measured live. The email claims exactly three things, each mapped
// to a record: the change is live (the terminal write), this is what you asked
// for (the job's own instruction, quoted), and here is the page (the site URL).
// composeReportResendEmail claims one thing: here is the report link that the
// client record itself carries. No ETAs anywhere — nothing here knows how long
// anything takes.

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
const {
  select: defaultSelect,
  upsertRow: defaultUpsert,
  recordEvent: defaultRecordEvent,
} = require("./store");

/** Durable promise rows: one caller's "you'll get an email" per job per kind. */
const PROMISES_TABLE = "riley_followup_promises";

/** The suppression ledger (lib/contact-suppression.js writes it; email.js,
 *  line-delivery.js, customer-sms.js, twilio.js and connect.js all read it). */
const SUPPRESSIONS_TABLE = "ghost_agency_suppressions";

/** The client record. Same table every other Riley surface resolves against. */
const PROSPECTS_TABLE = "ghost_agency_prospects";

/** The two promises this machinery can keep. */
const PROMISE_KINDS = Object.freeze(["live_email", "resend_report"]);

/** Terminal promise statuses. A terminal row is never re-sent and never
 *  re-refused: the completion email goes exactly once, whatever re-runs. */
const TERMINAL_STATUSES = Object.freeze([
  "sent",
  "refused_no_consent",
  "refused_suppressed",
  "refused_no_email",
  "refused_no_client_record",
  "refused_no_report_url",
  "refused_job_not_done",
  "failed_send",
]);

/** Ceiling on the whole terminal-hook delivery. The runner bounds it too; this
 *  is the module's own promise that it can never hang its caller. */
const DELIVER_CEILING_MS = 12_000;

/** The customer dashboard — the same URL the owner-rail update prints. */
const DASHBOARD_URL = "https://wss-ai.com/dashboard";

/** Longest quote of the caller's own instruction, in the email. */
const MAX_ASK_CHARS = 200;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function collapse(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function shorten(value, max) {
  const clean = collapse(value);
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** A sendable address, or "". Anything else is refused, never repaired. */
function normalizeEmail(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

/** Last-10 digits, for duplicate callbacks keyed by caller phone. */
function phoneDigits(value) {
  const d = String(value == null ? "" : value).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Single-line structured telemetry (the store's logUpsertDiagnostic shape). */
function telemetry(event, fields = {}) {
  const line = { event, ...fields };
  try {
    console.log(JSON.stringify(line));
  } catch {
    /* telemetry never breaks the promise it describes */
  }
}

function withCeiling(work, ms) {
  let timer = null;
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([Promise.resolve().then(work), expiry]).finally(() => { if (timer) clearTimeout(timer); });
}

function resolveDeps(deps = {}) {
  return {
    select: typeof deps.select === "function" ? deps.select : defaultSelect,
    upsertRow: typeof deps.upsertRow === "function" ? deps.upsertRow : defaultUpsert,
    recordEvent: typeof deps.recordEvent === "function" ? deps.recordEvent : defaultRecordEvent,
    sendResendEmail: typeof deps.sendResendEmail === "function"
      ? deps.sendResendEmail
      : (input) => require("./email").sendResendEmail(input), // lazy — keeps this module light to load
    now: typeof deps.now === "function" ? deps.now : () => new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// promise rows — the durable "I said I'd follow up"
// ---------------------------------------------------------------------------

function promiseKeyFor(jobId, kind) {
  return `fup:${kind === "resend_report" ? "resend_report" : "live_email"}:${String(jobId || "").trim()}`;
}

function cleanId(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max) || null;
}

/**
 * recordFollowUpPromise({ jobId, callId, siteSlug, clientRef, kind,
 *                         consentEmail, consentSource }, deps)
 *
 * Durable, idempotent, upgradable:
 *   - same (job, kind) twice -> one row; the second call reports
 *     { duplicate: true } and never duplicates the eventual email.
 *   - consent can be UPGRADED (false -> true, e.g. the caller said yes after
 *     the request was first noted) but never downgraded by a later call.
 *
 * Resolves { ok, mode, duplicate, promise }. mode is "dry_run" where no store
 * is configured — the row is still returned, so callers can proceed uniformly.
 */
async function recordFollowUpPromise(options = {}, deps = {}) {
  const d = resolveDeps(deps);
  const jobId = String(options.jobId || "").trim();
  if (!jobId) return { ok: false, reason: "jobId_required" };
  const kindRaw = String(options.promise_kind || options.kind || "live_email").trim();
  const kind = PROMISE_KINDS.includes(kindRaw) ? kindRaw : "live_email";
  const consent = options.consentEmail === true || options.consent === true || options.consent_email === true;

  const key = promiseKeyFor(jobId, kind);
  const existingAt = await d.select(PROMISES_TABLE, `promise_key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => null);
  const existing = existingAt && existingAt.ok === true && Array.isArray(existingAt.data) ? existingAt.data[0] : null;

  const row = {
    promise_key: key,
    job_id: jobId,
    call_id: cleanId(options.callId || options.call_id, 120),
    site_slug: cleanId(options.siteSlug || options.site_slug, 160),
    client_ref: cleanId(options.clientRef || options.client_ref, 40),
    promise_kind: kind,
    // NEVER downgrade: an existing yes stands whatever the later call carried.
    consent_email: existing ? existing.consent_email === true || consent : consent,
    consent_source: cleanId(consent ? (options.consentSource || options.consent_source || "verbal_call") : (existing ? existing.consent_source : null), 80),
    status: existing && TERMINAL_STATUSES.includes(String(existing.status || "")) ? existing.status : "pending",
    updated_at: d.now(),
  };

  const written = await d.upsertRow(PROMISES_TABLE, row, "promise_key");
  const mode = written && written.mode ? written.mode : "unknown";
  if (mode === "live_upsert_failed" || mode === "live_write_failed") {
    telemetry("riley_followup_promise_write_failed", { promise_key: key, job_id: jobId, error: written && written.error ? written.error.code : null });
    return { ok: false, reason: "promise_write_failed", detail: written && written.error ? written.error : null };
  }
  telemetry(mode === "dry_run" ? "riley_followup_promise_dry_run" : "riley_followup_promise_recorded", {
    promise_key: key,
    job_id: jobId,
    kind,
    consent_email: row.consent_email,
    duplicate: Boolean(existing),
  });
  return { ok: true, mode, duplicate: Boolean(existing), promise: row };
}

/**
 * The durable promise for a job (newest first), or null. kind narrows when
 * given; otherwise the first promise for the job wins, live_email preferred.
 */
async function followUpPromiseForJob(jobId, deps = {}) {
  const d = resolveDeps(deps);
  const id = String(jobId || "").trim();
  if (!id) return null;
  const found = await d.select(PROMISES_TABLE, `job_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=10`).catch(() => null);
  const rows = found && found.ok === true && Array.isArray(found.data) ? found.data : [];
  if (!rows.length) return null;
  return rows.find((r) => r.promise_kind === "live_email")
    || rows.find((r) => r.promise_kind === "resend_report")
    || rows[0];
}

/**
 * The inline flag a queueing lane can set ON the job row itself (the
 * `follow_up` jsonb column) instead of a separate promise write. Shapes:
 *   true                                     -> live_email, no consent recorded
 *   { promise_kind|kind, consent_email, consent_source } -> full promise
 *   anything else                            -> no promise
 */
function inlinePromiseFromJob(jobRow) {
  if (!isPlainObject(jobRow)) return null;
  const raw = jobRow.follow_up;
  if (raw === true) return { promise_kind: "live_email", consent_email: false, inline: true };
  if (isPlainObject(raw)) {
    const kindRaw = String(raw.promise_kind || raw.kind || "live_email");
    return {
      promise_kind: PROMISE_KINDS.includes(kindRaw) ? kindRaw : "live_email",
      consent_email: raw.consent_email === true,
      consent_source: String(raw.consent_source || "verbal_call"),
      inline: true,
    };
  }
  // Legacy spelling some lanes may reach for first: a flag inside the result blob.
  const result = isPlainObject(jobRow.result) ? jobRow.result : {};
  if (result.follow_up === true) return { promise_kind: "live_email", consent_email: false, inline: true };
  return null;
}

/**
 * writeInlinePromise(jobId, jobRow, inline, deps) — durably record a promise
 * that arrived as the job row's inline flag, so refusals and sends land on a
 * real row the audit trail can read.
 */
async function writeInlinePromise(jobId, jobRow, inline, d) {
  const key = promiseKeyFor(jobId, inline.promise_kind);
  const existingAt = await d.select(PROMISES_TABLE, `promise_key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => null);
  const existing = existingAt && existingAt.ok === true && Array.isArray(existingAt.data) ? existingAt.data[0] : null;
  const row = {
    promise_key: key,
    job_id: jobId,
    site_slug: cleanId(jobRow.site_slug, 160),
    promise_kind: inline.promise_kind,
    consent_email: existing ? existing.consent_email === true || inline.consent_email : inline.consent_email,
    consent_source: inline.consent_email ? cleanId(inline.consent_source, 80) : (existing ? existing.consent_source : null),
    status: existing && TERMINAL_STATUSES.includes(String(existing.status || "")) ? existing.status : "pending",
    updated_at: d.now(),
  };
  const written = await d.upsertRow(PROMISES_TABLE, row, "promise_key");
  const ok = written && written.mode !== "live_upsert_failed" && written.mode !== "live_write_failed";
  return ok ? row : null;
}

// ---------------------------------------------------------------------------
// the client record, the suppression ledger
// ---------------------------------------------------------------------------

/**
 * The client record for a site — the source of the recipient, the greeting
 * name and the Client ID. Same two-step lookup the owner-rail email uses
 * (site_slug first, then the row whose preview_url IS this site), but with the
 * full row so `email` / `owner_email` / record flags come back in one read.
 */
async function clientRecordForSite(siteSlug, deps = {}) {
  const d = resolveDeps(deps);
  const slug = String(siteSlug || "").trim();
  if (!slug) return null;
  const tryRead = async (query) => {
    const at = await d.select(PROSPECTS_TABLE, query).catch(() => null);
    return at && at.ok === true && Array.isArray(at.data) ? at.data[0] || null : null;
  };
  return (await tryRead(`select=*&site_slug=eq.${encodeURIComponent(slug)}&order=updated_at.desc&limit=1`))
    || (await tryRead(`select=*&preview_url=eq.https://${encodeURIComponent(slug)}.wss-ai.com/&order=updated_at.desc&limit=1`))
    || null;
}

/** The ONE address the customer rail may use: the one on the client record. */
function recipientFromRecord(record) {
  if (!isPlainObject(record)) return "";
  return normalizeEmail(record.email) || normalizeEmail(record.owner_email) || "";
}

/**
 * A hit on the suppression ledger (or a do-not-contact flag on the record
 * itself) means NO customer email, whatever the promise says. Mirrors
 * suppressionBlocked() in lib/email.js: reads ghost_agency_suppressions by
 * email and prospect id.
 */
async function suppressionHit({ record, recipientEmail }, deps = {}) {
  const d = resolveDeps(deps);
  // Contact-state flags carried on the record itself.
  const inner = isPlainObject(record && record.record) ? record.record : {};
  const flagValues = [
    record && record.do_not_contact, inner.do_not_contact,
    record && record.suppressed, inner.suppressed,
    record && record.contact_suppressed, inner.contact_suppressed,
  ];
  if (flagValues.some((v) => v === true || /^(1|true|yes|on)$/i.test(String(v == null ? "" : v).trim()))) {
    return { hit: true, where: "record_flag" };
  }
  const clauses = [];
  const email = normalizeEmail(recipientEmail);
  if (email) clauses.push(`email.eq.${encodeURIComponent(email)}`);
  const prospectId = record && record.prospect_id ? String(record.prospect_id).trim() : "";
  if (prospectId) clauses.push(`prospect_id.eq.${encodeURIComponent(prospectId)}`);
  if (!clauses.length) return { hit: false };
  const at = await d.select(
    SUPPRESSIONS_TABLE,
    `?select=suppression_key,email,prospect_id&or=(${clauses.join(",")})&limit=1`,
  ).catch(() => null);
  if (!at || at.ok !== true) return { hit: false, unavailable: true }; // a failed read refuses nothing and blocks nothing here — the caller treats unavailable as "fail closed" (see deliverFollowUp)
  return { hit: (at.data || []).length > 0, where: "suppressions_table" };
}

// ---------------------------------------------------------------------------
// compose — the customer rail, rendered from the same machinery as the
// owner digest but gated and addressed independently of it
// ---------------------------------------------------------------------------

function siteUrlFor(siteSlug, record) {
  const preview = record && typeof record.preview_url === "string" ? record.preview_url.trim() : "";
  if (/^https:\/\/[^\s]+$/i.test(preview)) return preview;
  return `https://${String(siteSlug || "").trim()}.wss-ai.com/`;
}

function footerBlock(line, reference) {
  const postal = collapse(process.env.GHOST_AGENCY_POSTAL_ADDRESS);
  const phoneLine = line.phone
    ? `<p style="margin:10px 0 0;font-family:${design.FONT_STACK};font-size:13.5px;line-height:1.5;color:${design.PALETTE.ink}">&#128222; Call Riley: <a href="${escapeHtml(line.telHref)}" style="color:${design.PALETTE.accent};text-decoration:none;font-weight:700">${escapeHtml(line.display)}</a></p>`
    : "";
  const dashboardLine = `<p style="margin:6px 0 0;font-family:${design.FONT_STACK};font-size:13.5px;line-height:1.5;color:${design.PALETTE.ink}">Your dashboard: <a href="${DASHBOARD_URL}" style="color:${design.PALETTE.accent};text-decoration:none;font-weight:700">wss-ai.com/dashboard</a></p>`;
  const referenceLine = reference
    ? `<p style="margin:6px 0 0;${design.TYPE.caption}">Client ID: <span style="font-weight:800;color:${design.PALETTE.ink}">${escapeHtml(reference)}</span> — your login, and what you read to me when you call.</p>`
    : "";
  const identity = [escapeHtml(WSS_IDENTITY), escapeHtml(LEGAL_ENTITY), postal ? escapeHtml(postal) : ""]
    .filter(Boolean)
    .join(" &middot; ");
  return { phoneLine, dashboardLine, referenceLine, identity };
}

function textFooter(line, reference) {
  const postal = collapse(process.env.GHOST_AGENCY_POSTAL_ADDRESS);
  return [
    "--",
    WSS_IDENTITY,
    LEGAL_ENTITY,
    postal || null,
    line.phone ? `Call Riley: ${line.display}` : null,
    `Your dashboard: ${DASHBOARD_URL}`,
    reference ? `Client ID: ${reference} — your login, and what you read to me when you call.` : null,
    OPT_OUT_PROMISE,
  ].filter(Boolean).join("\n");
}

/**
 * composeCustomerLiveEmail({ jobRow, record }) -> { ok, subject, html, text }
 *   | { ok: false, reason }
 *
 * reason "job_not_done" is the truth gate: the runner's `done` is the ONLY
 * state from which "it's live" may be said, because that write happens after
 * the rendered page was measured (see lib/edit-job-runner.js).
 */
function composeCustomerLiveEmail({ jobRow, record } = {}) {
  if (!isPlainObject(jobRow) || String(jobRow.status || "").toLowerCase() !== "done") {
    return { ok: false, reason: "job_not_done" };
  }
  const siteSlug = String(jobRow.site_slug || "").trim();
  if (!siteSlug) return { ok: false, reason: "job_has_no_site" };

  const name = collapse(record && record.business_name);
  const reference = record ? clientReferenceCode(record) : "";
  const line = resolveRileyLine({ env: process.env, allowAgencyLine: true });
  const ask = shorten(jobRow.instruction, MAX_ASK_CHARS);
  const greeting = name ? `Hi ${name} — it's Riley.` : "Hi — it's Riley.";
  const askedLine = ask
    ? `You asked: "${ask}"`
    : "You asked for a change to your site";
  const doneLine = "— it's done, and it's live on your site right now.";
  const url = siteUrlFor(siteSlug, record);
  const nextStep = `Reply to this email with the next thing you want changed${line.phone ? `, or call me at ${line.display}` : ""} — I'll take it from there.`;

  const { phoneLine, dashboardLine, referenceLine, identity } = footerBlock(line, reference);
  const bodyHtml = `<p style="margin:0 0 10px;${design.TYPE.body}">${escapeHtml(askedLine)}${escapeHtml(doneLine)}</p>
        <p style="margin:0 0 16px;${design.TYPE.body}">See it live: <a href="${escapeHtml(url)}" style="color:${design.PALETTE.accent};text-decoration:none;font-weight:700">${escapeHtml(url)}</a></p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%"><tr>
          <td width="4" style="width:4px;background:${design.PALETTE.accent};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
          <td style="padding-left:14px;font-family:${design.FONT_STACK};font-size:15px;line-height:1.6;font-weight:700;color:${design.PALETTE.ink}">${escapeHtml(nextStep)}</td>
        </tr></table>`;

  const subject = name ? `Riley — it's live on ${name}'s site` : "Riley — it's live on your site";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${design.PALETTE.page};font-family:${design.FONT_STACK}">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${design.PALETTE.page}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" cellpadding="0" cellspacing="0" width="680" style="max-width:680px;width:100%">

  <tr><td style="padding:0 6px 18px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle" style="padding-right:12px">
        <img src="${design.WSS_MARK_URL}" width="44" height="44" alt="WSS Labs" style="display:block;width:44px;height:44px;border:0;border-radius:12px">
      </td>
      <td valign="middle">
        <span style="font-family:${design.FONT_STACK};font-size:16px;font-weight:800;color:${design.PALETTE.ink};letter-spacing:-.01em">WSS Labs</span><br>
        <span style="font-family:${design.FONT_STACK};font-size:12px;line-height:1.5;color:${design.PALETTE.muted}">Riley &middot; ${escapeHtml(RILEY_ROLE)}</span>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 0 14px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle()}">
      <tr><td style="padding:5px 0 0;background:${design.PALETTE.accent};font-size:0;line-height:0;border-radius:13px 13px 0 0">&nbsp;</td></tr>
      <tr><td style="padding:26px 26px 22px">
        <h1 style="margin:0 0 8px;${design.TYPE.title}">&#10003; ${escapeHtml(greeting)}</h1>
        ${bodyHtml}
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:0 6px 0">
    <p style="margin:0;font-family:${design.FONT_STACK};font-size:17px;line-height:1.35;font-weight:800;color:${design.PALETTE.ink}">&mdash; Riley</p>
    <p style="margin:3px 0 0;${design.TYPE.caption}">${escapeHtml(RILEY_ROLE.replace(/^your /, ""))} &middot; WSS Labs</p>
    <p style="margin:8px 0 0;${design.TYPE.small}">${escapeHtml(RILEY_DISCLOSURE)}</p>
    ${phoneLine}
    ${dashboardLine}
    ${referenceLine}
  </td></tr>

  <tr><td style="padding:24px 6px 0">
    <div style="border-top:1px solid ${design.PALETTE.line};padding-top:18px">
      ${optOutPromiseHtml()}
      <p style="margin:0;font-family:${design.FONT_STACK};font-size:11.5px;line-height:1.6;color:${design.PALETTE.muted}">${identity}</p>
    </div>
  </td></tr>

</table></td></tr></table>
</body></html>
`;

  const text = [
    "WSS Labs",
    `Riley — ${RILEY_ROLE}`,
    "",
    greeting,
    `${askedLine}${doneLine}`,
    `See it live: ${url}`,
    "",
    `Next step: ${nextStep}`,
    "",
    "— Riley",
    `${RILEY_ROLE.replace(/^your /, "")} · WSS Labs`,
    RILEY_DISCLOSURE,
    line.phone ? `Call Riley: ${line.display}` : null,
    `Your dashboard: ${DASHBOARD_URL}`,
    reference ? `Client ID: ${reference} — your login, and what you read to me when you call.` : null,
    "",
    textFooter(line, reference),
  ].filter((v) => v !== null).join("\n");

  return { ok: true, subject, html, text, url, reference };
}

/** The report URL a client record itself carries (the roadmap / review sheet). */
function reportUrlFromRecord(record) {
  if (!isPlainObject(record)) return "";
  const inner = isPlainObject(record.record) ? record.record : {};
  const candidates = [record.report_url, inner.report_url, record.preview_report_url, inner.preview_report_url];
  for (const candidate of candidates) {
    const url = String(candidate == null ? "" : candidate).trim();
    if (/^https:\/\/[^\s]+$/i.test(url)) return url;
  }
  return "";
}

/**
 * composeReportResendEmail({ record, reportUrl }) — "send the review sheet
 * again". Claims exactly one thing: the link, which the client record itself
 * carries. No link on the record -> refuse; a fabricated one is the same
 * defect as a fabricated claim.
 */
function composeReportResendEmail({ record, reportUrl } = {}) {
  const url = String(reportUrl || "").trim() || reportUrlFromRecord(record);
  if (!/^https:\/\/[^\s]+$/i.test(url)) return { ok: false, reason: "no_report_url" };
  const name = collapse(record && record.business_name);
  const reference = record ? clientReferenceCode(record) : "";
  const line = resolveRileyLine({ env: process.env, allowAgencyLine: true });
  const greeting = name ? `Hi ${name} — it's Riley.` : "Hi — it's Riley.";
  const subject = "Riley — the review sheet, again";
  const { phoneLine, dashboardLine, referenceLine, identity } = footerBlock(line, reference);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${design.PALETTE.page};font-family:${design.FONT_STACK}">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${design.PALETTE.page}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" cellpadding="0" cellspacing="0" width="680" style="max-width:680px;width:100%">
  <tr><td style="padding:0 0 18px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${design.cardStyle()}">
      <tr><td style="padding:5px 0 0;background:${design.PALETTE.accent};font-size:0;line-height:0;border-radius:13px 13px 0 0">&nbsp;</td></tr>
      <tr><td style="padding:26px 26px 22px">
        <h1 style="margin:0 0 8px;${design.TYPE.title}">${escapeHtml(greeting)}</h1>
        <p style="margin:0 0 14px;${design.TYPE.body}">Here's the review sheet you asked me to send again — the same report, same link:</p>
        <p style="margin:0 0 6px;${design.TYPE.body}"><a href="${escapeHtml(url)}" style="color:${design.PALETTE.accent};text-decoration:none;font-weight:700;word-break:break-all">${escapeHtml(url)}</a></p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 6px 0">
    <p style="margin:0;font-family:${design.FONT_STACK};font-size:17px;line-height:1.35;font-weight:800;color:${design.PALETTE.ink}">&mdash; Riley</p>
    <p style="margin:3px 0 0;${design.TYPE.caption}">${escapeHtml(RILEY_ROLE.replace(/^your /, ""))} &middot; WSS Labs</p>
    <p style="margin:8px 0 0;${design.TYPE.small}">${escapeHtml(RILEY_DISCLOSURE)}</p>
    ${phoneLine}
    ${dashboardLine}
    ${referenceLine}
  </td></tr>
  <tr><td style="padding:24px 6px 0">
    <div style="border-top:1px solid ${design.PALETTE.line};padding-top:18px">
      ${optOutPromiseHtml()}
      <p style="margin:0;font-family:${design.FONT_STACK};font-size:11.5px;line-height:1.6;color:${design.PALETTE.muted}">${identity}</p>
    </div>
  </td></tr>
</table></td></tr></table>
</body></html>
`;

  const text = [
    greeting,
    "Here's the review sheet you asked me to send again — the same report, same link:",
    url,
    "",
    "— Riley",
    textFooter(line, reference),
  ].filter(Boolean).join("\n");

  return { ok: true, subject, html, text, url, reference };
}

// ---------------------------------------------------------------------------
// deliver — the terminal hook
// ---------------------------------------------------------------------------

async function markPromise(promise, patch, d) {
  // The row as read carries the GENERATED ALWAYS `id` column; writing it back
  // is a PostgREST 428C9 rejection (store.js strips generated columns only for
  // its own allowlist), so the identity never re-enters a write here.
  const { id: _generated, ...carry } = promise || {};
  const row = { ...carry, ...patch, updated_at: d.now() };
  await d.upsertRow(PROMISES_TABLE, row, "promise_key").catch(() => null);
}

/**
 * deliverFollowUp({ jobId, siteSlug, instruction, jobRow }, deps)
 *
 * Called by lib/edit-job-runner.js right after a terminal `done` write. Fully
 * guarded: resolves to a result object, never throws, and bounds itself so it
 * can never hang the runner. When there is no promise for the job this is a
 * one-read no-op — the overwhelming majority of jobs.
 *
 * Outcomes (also on the promise row, always):
 *   { ok: true, outcome: "no_promise" }            — nothing was promised
 *   { ok: true, outcome: "skipped", status }        — already terminal (dupe)
 *   { ok: true, outcome: "sent", to, subject }      — the promise was kept
 *   { ok: true, outcome: "refused", status, reason } — the gate said no; the
 *     owner rail (notifyOwner) remains the only send, and the row says why.
 */
async function deliverFollowUp(options = {}, deps = {}) {
  const d = resolveDeps(deps);
  const jobId = String(options.jobId || "").trim();
  if (!jobId) return { ok: false, reason: "jobId_required" };

  return withCeiling(async () => {
    // 1. THE PROMISE. Durable row first; the job row's inline flag second.
    let promise = await followUpPromiseForJob(jobId, d);
    let inline = null;
    if (!promise) {
      inline = inlinePromiseFromJob(options.jobRow);
      if (inline) promise = await writeInlinePromise(jobId, options.jobRow || {}, inline, d);
    }
    if (!promise) {
      return { ok: true, outcome: "no_promise" };
    }
    const status = String(promise.status || "pending");
    if (TERMINAL_STATUSES.includes(status)) {
      return { ok: true, outcome: "skipped", status, promise_key: promise.promise_key };
    }

    const kind = PROMISE_KINDS.includes(String(promise.promise_kind)) ? promise.promise_kind : "live_email";

    // 2. THE TRUTH GATE. Only a `done` job can produce a "it's live" email.
    const jobRow = isPlainObject(options.jobRow) ? options.jobRow : null;
    if (kind === "live_email" && (!jobRow || String(jobRow.status || "").toLowerCase() !== "done")) {
      await markPromise(promise, { status: "refused_job_not_done" }, d);
      return { ok: true, outcome: "refused", status: "refused_job_not_done" };
    }

    // 3. THE CONSENT GATE. No recorded consent -> owner-only, row says why.
    if (promise.consent_email !== true) {
      await markPromise(promise, { status: "refused_no_consent" }, d);
      await d.recordEvent("riley_followup_refused", {
        jobId,
        promise_key: promise.promise_key,
        refused: "no_consent",
        owner_only: true,
      }).catch(() => {});
      telemetry("riley_followup_refused", { job_id: jobId, refused: "no_consent", owner_only: true });
      return { ok: true, outcome: "refused", status: "refused_no_consent", ownerOnly: true };
    }

    // 4. THE CLIENT RECORD. The recipient comes from here, or there is no send.
    const siteSlug = String(options.siteSlug || promise.site_slug || (jobRow && jobRow.site_slug) || "").trim();
    const record = await clientRecordForSite(siteSlug, d);
    if (!record) {
      await markPromise(promise, { status: "refused_no_client_record" }, d);
      return { ok: true, outcome: "refused", status: "refused_no_client_record" };
    }
    const recipient = recipientFromRecord(record);
    if (!recipient) {
      await markPromise(promise, { status: "refused_no_email" }, d);
      await d.recordEvent("riley_followup_refused", {
        jobId,
        promise_key: promise.promise_key,
        refused: "no_email_on_record",
        owner_only: true,
      }).catch(() => {});
      return { ok: true, outcome: "refused", status: "refused_no_email", ownerOnly: true };
    }

    // 5. THE SUPPRESSION LEDGER. A do-not-contact hit refuses the send even
    // with consent — the row on the ledger is the older promise, and it wins.
    const suppressed = await suppressionHit({ record, recipientEmail: recipient }, d);
    if (suppressed.hit) {
      await markPromise(promise, { status: "refused_suppressed" }, d);
      await d.recordEvent("riley_followup_refused", {
        jobId,
        promise_key: promise.promise_key,
        refused: "suppressed",
        where: suppressed.where,
        owner_only: true,
      }).catch(() => {});
      return { ok: true, outcome: "refused", status: "refused_suppressed", ownerOnly: true };
    }
    // A ledger read that FAILED is treated as a hit: fail closed. The promise
    // stays pending so the next honest read can send it; today nothing re-runs
    // a done job, so this surfaces as a recorded no-send, not a wrong send.
    if (suppressed.unavailable) {
      await markPromise(promise, { status: "failed_send", detail: { reason: "suppression_check_unavailable" } }, d);
      return { ok: true, outcome: "refused", status: "failed_send", reason: "suppression_check_unavailable" };
    }

    // 6. COMPOSE + SEND — the only place the customer rail can fire.
    const composed = kind === "resend_report"
      ? composeReportResendEmail({ record })
      : composeCustomerLiveEmail({ jobRow: { ...jobRow, status: "done", site_slug: siteSlug }, record });
    if (!composed.ok) {
      await markPromise(promise, { status: kind === "resend_report" ? "refused_no_report_url" : "refused_job_not_done" }, d);
      return { ok: true, outcome: "refused", status: kind === "resend_report" ? "refused_no_report_url" : "refused_job_not_done" };
    }

    const send = await d.sendResendEmail({
      to: recipient,
      cc: [],
      bcc: [],
      senderKind: "transactional",
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
      idempotencyKey: promise.promise_key, // a retried send is deduped at the provider boundary
    });
    const sent = Boolean(send && send.mode === "sent");
    await markPromise(promise, {
      status: sent ? "sent" : "failed_send",
      recipient,
      detail: { message_id: (send && send.id) || null, mode: (send && send.mode) || "unknown", kind },
    }, d);

    if (!sent) {
      await d.recordEvent("riley_followup_failed", {
        jobId,
        promise_key: promise.promise_key,
        mode: (send && send.mode) || "unknown",
      }).catch(() => {});
      return { ok: true, outcome: "refused", status: "failed_send", to: recipient };
    }

    await d.recordEvent("riley_followup_sent", {
      jobId,
      promise_key: promise.promise_key,
      kind,
      to: recipient,
      site_slug: siteSlug,
      message_id: (send && send.id) || null,
    }).catch(() => {});
    telemetry("riley_followup_sent", { job_id: jobId, kind, to: recipient, site_slug: siteSlug });
    return { ok: true, outcome: "sent", to: recipient, subject: composed.subject, kind, promise_key: promise.promise_key };
  }, DELIVER_CEILING_MS).then((resolved) => resolved || { ok: true, outcome: "timeout" });
}

module.exports = {
  PROMISES_TABLE,
  PROMISE_KINDS,
  TERMINAL_STATUSES,
  DELIVER_CEILING_MS,
  DASHBOARD_URL,
  composeCustomerLiveEmail,
  composeReportResendEmail,
  clientRecordForSite,
  deliverFollowUp,
  followUpPromiseForJob,
  inlinePromiseFromJob,
  normalizeEmail,
  phoneDigits,
  promiseKeyFor,
  recipientFromRecord,
  recordFollowUpPromise,
  reportUrlFromRecord,
  suppressionHit,
};
