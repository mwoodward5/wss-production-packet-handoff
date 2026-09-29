"use strict";

// lib/riley-context.js — what a human assistant would have open.
//
// ── THE FAILURE THIS CLOSES, IN THE OWNER'S OWN RECORDINGS ──────────────────
//
// The owner asked Riley, on a call, "did you get my email?" In one call Riley
// said it had no access to email. In another call Riley sent one. Both
// statements were true of the tools in front of it and neither was true of the
// system: send-note can send, and nothing could READ. So the caller got a
// confident answer to a question about state from an agent with no state.
//
// That is not fixed by another tool. It is fixed by the agent knowing, before
// it opens its mouth, what has actually passed between us and this customer. A
// receptionist who knows you does not have a "check the email" button; she has
// the thread open. This module is the thread.
//
// ── FIVE SOURCES, ONE READ, NO INVENTION ───────────────────────────────────
//
//   emails       what we have sent them and anything they sent back
//   dashboard    what they typed into the dashboard chat, in their own words
//   siteChat     what visitors have said in the chat widget on their website
//   edits        every change they asked for and WHAT ACTUALLY HAPPENED to it
//   uploads      the files they handed us
//
// Each section answers independently: { ok, items, note }. A failed read is
// `ok: false` with a note, never an empty array. lib/customer-site.js paid for
// that lesson once already — a select that 400s returns no rows, and a caller
// that only checks the shape tells the customer there is nothing there. "You
// never sent me anything" and "I can't reach your mail right now" are different
// sentences and only one of them can be said to a man who did send it.
//
// ── TENANT SCOPE: THE SLUG COMES FROM THE SIGNATURE ─────────────────────────
//
// readRileyContext takes a SIGNED scope token (lib/dashboard-link.js
// signScopeToken — the same `s2.` credential the customer dashboard is gated
// on) and derives the slug from it. There is no parameter that names a slug and
// is trusted. A caller that also passes `siteSlug` is only allowed to pass the
// one already inside the signature; anything else is NOT FOUND.
//
// 404, not 403. A 403 on a foreign slug is an oracle: probe the endpoint and it
// tells you which businesses exist. Both a forged token and a real token
// pointed at someone else's slug produce the identical "not_found" answer,
// which is the same posture api/connect/chat-post.js takes on a thread that is
// not yours.
//
// This module NEVER writes. Not a note, not a read receipt, not an event. Eyes.

const { verifyScopeToken } = require("./dashboard-link");
const { select: defaultSelect } = require("./store");
const { siteSlugFromRow } = require("./site-edit-targets");
const { parseEditInstruction } = require("./customer-uploads");
const { listTenantUploads } = require("./riley-uploads");

/** Per-section caps. Small on purpose: this is spoken aloud mid-call, not a
 *  report. Enough to answer "did you get my email" and "what did I ask for". */
const SECTION_LIMITS = Object.freeze({
  emails: 6,
  dashboard: 6,
  siteChat: 5,
  edits: 6,
  uploads: 5,
});

/** How far back anything counts as "recent" for the spoken summary. */
const RECENT_DAYS = 30;

// ── THE PRICE PIN ───────────────────────────────────────────────────────────
// Forensics on calls 13–17 found THREE price systems in one corpus: a v0
// prompt quoting $99/$499–$1299, the v2/v4 prompt saying $200, and the
// customer's own email saying $149/$199. A price is a promise, and a promise
// that drifts with whichever prompt version is live is a lie one call at a
// time. So the price is not a prompt fact at all: it is ONE line carried
// server-side in every look_up_customer response, from
// GHOST_AGENCY_PRICE_LINE. No prompt version can drift it, and Riley quotes
// nothing he was not handed by this response.
const DEFAULT_PRICE_LINE = "Care plans start at $149/mo — everything included.";

function priceLine(env = process.env) {
  const configured = String(env.GHOST_AGENCY_PRICE_LINE || "").trim();
  return configured || DEFAULT_PRICE_LINE;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

const NOT_FOUND = Object.freeze({ ok: false, status: 404, error: "not_found" });

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

function rowsOf(result) {
  if (!result || result.ok !== true || !Array.isArray(result.data)) return null; // null = unreadable
  return result.data;
}

function clean(value, cap = 240) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, cap);
}

function iso(value) {
  const at = Date.parse(String(value || ""));
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
}

function digits10(value) {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

const section = (ok, items, note) => ({ ok, items: ok ? items : [], note: note || null });

/**
 * resolveTenant(slug) -> { site_slug, prospect_id, business_name, emails[], phone10 }
 *
 * The identity facts needed to find this customer's traffic in tables that are
 * keyed by prospect id, email address or phone number rather than by slug.
 *
 * The prospect row is matched the same way describeSiteEditTarget does it —
 * loose LIKE on preview_url, then re-derive the slug from the row and demand an
 * exact match — because a substring match on a slug is how one business's data
 * gets attributed to another whose slug contains it.
 */
async function resolveTenant({ siteSlug, select = defaultSelect } = {}) {
  const slug = String(siteSlug || "").trim().toLowerCase();
  const tenant = { site_slug: slug, prospect_id: null, business_name: null, emails: [], phone10: "" };
  let found = null;
  try {
    found = await select("ghost_agency_prospects", `?select=*&preview_url=ilike.*${encodeURIComponent(slug)}*&limit=25`);
  } catch {
    found = null;
  }
  const rows = rowsOf(found);
  if (!rows) return { ...tenant, readable: false };
  const exact = rows.filter((r) => siteSlugFromRow(r) === slug);
  // Two rows claiming one live site is the wrong-client hazard describeSiteEditTarget
  // refuses to name. We do not refuse to show the site's own edits — those are
  // keyed by slug and unambiguous — but we will not attribute email or phone
  // traffic to a business we cannot single out.
  if (exact.length !== 1) return { ...tenant, readable: true, ambiguous: exact.length > 1 };
  const row = exact[0];
  const record = isPlainObject(row.record) ? row.record : {};
  const emails = [...new Set([row.email, row.owner_email, record.email, record.owner_email]
    .map((e) => String(e || "").trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  return {
    ...tenant,
    readable: true,
    prospect_id: row.prospect_id || null,
    business_name: row.business_name || record.business_name || null,
    emails,
    phone10: digits10(row.phone || record.phone),
  };
}

// ---------------------------------------------------------------------------
// SECTION READERS. Each one is independently failable and independently honest.
// ---------------------------------------------------------------------------

/**
 * EMAIL, BOTH DIRECTIONS.
 *
 * Outbound is what we can prove we sent: `riley.note_sent` (the note Riley
 * itself sent) and `operator.mirror_proof_sent` (a preview send, keyed by
 * prospect id). Inbound is `reply.received`, written by
 * api/webhooks/email-inbound.js.
 *
 * ── "WE EMAILED YOU" IS A CLAIM ABOUT AN ADDRESS ────────────────────────────
 *
 * The first version of this function attributed an outbound email to the
 * customer whenever the event was about their site — by prospect id, or by the
 * caller's phone number. Run against production it produced this sentence for
 * Poor John's Plumbing:
 *
 *     "We last emailed them today: Your new website preview"
 *
 * and it was FALSE. Every send in this system currently goes to
 * woodwardsoftware@gmail.com: the owner-only rail is on, and the recipient
 * recorded on that very event was the owner's inbox, not the plumber's. Riley
 * would have told a man we had emailed him something he was never sent — the
 * original "did you get my email?" defect, rebuilt on better plumbing.
 *
 * So attribution is by RECIPIENT ADDRESS and nothing else. An email about this
 * customer that went somewhere else is counted separately and described for
 * what it is. `to_them` is on every outbound row, and composeSpoken will not
 * say "we emailed them" without it.
 *
 * MEASURED 2026-08-12: there are ZERO reply.received rows in production —
 * nothing has ever arrived through the inbound lane. Reported as a note, not
 * as an empty list, because "nothing on file" and "they never wrote" are
 * different sentences and only one of them may be said to a man who did write.
 */
async function readEmails({ tenant, select, limit }) {
  const wanted = ["riley.note_sent", "operator.mirror_proof_sent", "reply.received"];
  const filter = `type=in.(${wanted.map((t) => `"${t}"`).join(",")})`;
  let found = null;
  try {
    found = await select("ghost_agency_events", `${filter}&order=created_at.desc&limit=300`);
  } catch {
    found = null;
  }
  const rows = rowsOf(found);
  if (!rows) return section(false, [], "The mail record could not be read just now.");

  const emails = new Set(tenant.emails || []);
  const items = [];
  let internal = 0;
  for (const row of rows) {
    const payload = isPlainObject(row.payload) ? row.payload : {};
    const type = String(row.type || "");
    let aboutThisSite = false;
    let toThem = false;
    let entry = null;

    if (type === "riley.note_sent") {
      const to = String(payload.to || "").trim().toLowerCase();
      toThem = Boolean(to && emails.has(to));
      aboutThisSite = toThem || Boolean(tenant.phone10 && digits10(payload.caller) === tenant.phone10);
      entry = {
        direction: "out",
        to_them: toThem,
        at: iso(row.created_at),
        subject: clean(payload.subject, 160),
        delivered: payload.sent === true,
        via: "riley",
      };
    } else if (type === "operator.mirror_proof_sent") {
      const to = String(payload.recipient || "").trim().toLowerCase();
      toThem = Boolean(to && emails.has(to));
      aboutThisSite = toThem || (Boolean(tenant.prospect_id) && String(payload.prospect_id || "") === tenant.prospect_id);
      entry = {
        direction: "out",
        to_them: toThem,
        at: iso(row.created_at),
        subject: clean(`Your new website preview — ${payload.business_name || tenant.business_name || ""}`, 160),
        delivered: String(payload.mode || "") === "sent",
        via: "team",
      };
    } else if (type === "reply.received") {
      const from = String(payload.fromEmail || "").trim().toLowerCase();
      aboutThisSite = Boolean(from && emails.has(from))
        || (Boolean(tenant.prospect_id) && String(payload.prospectId || "") === tenant.prospect_id);
      toThem = true; // inbound: they are the sender, so there is nothing to mis-attribute
      entry = {
        direction: "in",
        to_them: true,
        at: iso(row.created_at),
        subject: clean(payload.subject, 160),
        preview: clean(payload.preview, 220),
        delivered: true,
        via: "email",
      };
    }

    if (!aboutThisSite || !entry) continue;
    if (entry.direction === "out" && !toThem) { internal += 1; continue; }
    items.push(entry);
    if (items.length >= limit) break;
  }

  const notes = [];
  if (!items.some((i) => i.direction === "in")) {
    notes.push("No email FROM this customer is recorded. The inbound-reply lane has never written a row in production, so this is 'nothing on file', not 'they never wrote'.");
  }
  if (internal) {
    notes.push(`${internal} email${internal === 1 ? "" : "s"} about this site went to our own inbox, not to the customer — the owner-only send rail is on. Never describe those as emails they were sent.`);
  }
  if (!emails.size) {
    notes.push("No email address is on file for this customer, so nothing can be matched to them by address.");
  }
  return section(true, items, notes.join(" ") || null);
}

/**
 * THE DASHBOARD CHAT, IN THEIR OWN WORDS.
 *
 * ghost_agency_edit_jobs is the transcript: api/connect/edit.js writes the
 * customer's typed message into `instruction` (composed with any attachments),
 * and parseEditInstruction splits their words back out. `via` — dashboard vs
 * phone — lives on the ghost_agency_site_edit_queued event rather than the row,
 * so it is read alongside and matched by jobId. A job with no such event is
 * reported with channel "unknown"; guessing would be inventing provenance.
 */
async function readJobs({ tenant, select, limit }) {
  let found = null;
  try {
    found = await select(
      "ghost_agency_edit_jobs",
      `site_slug=eq.${encodeURIComponent(tenant.site_slug)}&order=created_at.desc&limit=${Math.max(limit, SECTION_LIMITS.edits)}`,
    );
  } catch {
    found = null;
  }
  const rows = rowsOf(found);
  if (!rows) return { rows: null };

  // Channel, best-effort and clearly labelled when unknown.
  const channels = new Map();
  try {
    const ev = await select(
      "ghost_agency_events",
      `type=eq.ghost_agency_site_edit_queued&payload->>siteSlug=eq.${encodeURIComponent(tenant.site_slug)}&order=created_at.desc&limit=60`,
    );
    for (const row of rowsOf(ev) || []) {
      const payload = isPlainObject(row.payload) ? row.payload : {};
      if (payload.jobId) channels.set(String(payload.jobId), payload.via === "dashboard_chat" ? "dashboard" : "phone");
    }
  } catch { /* channel is a nicety; the transcript is the point */ }

  return { rows, channels };
}

function shapeDashboard(rows, channels, limit) {
  const items = [];
  for (const row of rows) {
    const { message, attachments } = parseEditInstruction(row.instruction);
    if (!message) continue;
    items.push({
      at: iso(row.created_at),
      said: clean(message, 300),
      channel: channels.get(String(row.job_id)) || "unknown",
      attachments: attachments.length,
    });
    if (items.length >= limit) break;
  }
  return section(true, items, items.length ? null : "Nothing typed into the dashboard chat is on file for this site.");
}

/**
 * EDITS, WITH REAL OUTCOMES.
 *
 * `outcome` is the row's status, and `landed` is only true for `done`, which
 * since lib/edit-verify.js means the deployed page was RENDERED and the change
 * measured on it. `say` is the sentence already composed for this customer;
 * repeating it keeps the phone and the dashboard telling one story.
 */
function shapeEdits(rows, channels, limit) {
  const items = [];
  for (const row of rows) {
    const result = isPlainObject(row.result) ? row.result : {};
    const { message } = parseEditInstruction(row.instruction);
    const status = String(row.status || "").toLowerCase();
    const started = Date.parse(String(row.created_at || ""));
    const ended = Date.parse(String(row.updated_at || ""));
    items.push({
      at: iso(row.created_at),
      asked: clean(message || row.instruction, 220),
      outcome: status,
      landed: status === "done",
      // A `failed` row that DEPLOYED and then failed its rendered check is not
      // "nothing changed" — it is either rolled back or not, and the runner
      // records which. Carried through so nobody has to guess out loud.
      not_landed: result.not_landed === true,
      reverted: result.reverted === undefined ? null : result.reverted,
      say: clean(result.say, 320) || null,
      took_ms: Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : null,
      channel: channels.get(String(row.job_id)) || "unknown",
    });
    if (items.length >= limit) break;
  }
  return section(true, items, items.length ? null : "No changes have ever been requested for this site.");
}

/**
 * THEIR WEBSITE'S OWN CHAT. These are their CUSTOMERS talking to them, not them
 * talking to us — labelled as such so Riley never reads a visitor's question
 * back as if the caller had asked it.
 */
async function readSiteChat({ tenant, select, limit }) {
  let found = null;
  try {
    found = await select(
      "connect_threads",
      `?select=id,channel,contact_name,subject,unread,last_message_at,created_at&site_slug=eq.${encodeURIComponent(tenant.site_slug)}&order=last_message_at.desc&limit=${limit}`,
    );
  } catch {
    found = null;
  }
  const threads = rowsOf(found);
  if (!threads) return section(false, [], "Their website's message log could not be read just now.");
  if (!threads.length) return section(true, [], "No one has used the chat on their website.");

  const byId = new Map(threads.map((t) => [Number(t.id), t]));
  let messages = null;
  try {
    const ids = threads.map((t) => Number(t.id)).filter(Number.isFinite);
    const res = await select(
      "connect_messages",
      `?select=thread_id,direction,body,created_at&thread_id=in.(${ids.join(",")})&order=created_at.desc&limit=200`,
    );
    messages = rowsOf(res);
  } catch {
    messages = null;
  }

  const firstInbound = new Map();
  for (const m of messages || []) {
    if (String(m.direction || "") !== "inbound") continue;
    const key = Number(m.thread_id);
    if (!firstInbound.has(key)) firstInbound.set(key, clean(m.body, 200));
  }

  const items = [...byId.values()].map((t) => ({
    at: iso(t.last_message_at || t.created_at),
    from: clean(t.contact_name, 80) || "Website visitor",
    channel: clean(t.channel, 20),
    unread: t.unread === true,
    asked: firstInbound.get(Number(t.id)) || null,
  }));
  return section(true, items, messages ? null : "Thread list read; the messages inside them could not be read.");
}

/** THE FILES THEY HANDED US. Same listing the edit path selects from, so what
 *  Riley can see and what Riley can use are the same set. */
async function readUploads({ tenant, limit, fetchImpl }) {
  const listed = await listTenantUploads({ siteSlug: tenant.site_slug, fetchImpl });
  if (!listed.ok) return section(false, [], "Their uploaded files could not be listed just now.");
  const items = listed.uploads.slice(0, limit).map((u) => ({
    at: iso(u.at),
    name: u.name,
    kind: u.kind,
    bytes: u.bytes,
    usable_on_site: u.kind === "photo",
  }));
  return section(true, items, items.length ? null : "They haven't sent us any files.");
}

// ---------------------------------------------------------------------------
// THE SPOKEN BRIEF
// ---------------------------------------------------------------------------

function ago(at, now) {
  const t = Date.parse(String(at || ""));
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return "a while back";
}

/**
 * composeSpoken(sections, { now }) -> one short paragraph Riley can work from.
 *
 * Every clause is anchored to a row that was read. A section that could not be
 * read says so — "I can't see X right now" is a sentence Riley can say without
 * lying, and it is the whole reason each section carries `ok` separately.
 */
function composeSpoken(sections, { now = Date.now() } = {}) {
  const parts = [];
  const unreadable = [];

  if (!sections.emails.ok) unreadable.push("your emails");
  else {
    const inbound = sections.emails.items.filter((i) => i.direction === "in");
    // ONLY mail that actually reached THEIR address. See the note on readEmails:
    // every send in this system currently lands in the owner's inbox, and
    // "we emailed you" about a message they never received is the very defect
    // this module exists to end.
    const outbound = sections.emails.items.filter((i) => i.direction === "out" && i.to_them === true);
    if (inbound.length) parts.push(`They emailed us ${ago(inbound[0].at, now)}${inbound[0].subject ? ` about "${inbound[0].subject}"` : ""}.`);
    else parts.push("Nothing from them by email is on file.");
    if (outbound.length) parts.push(`We last emailed them ${ago(outbound[0].at, now)}${outbound[0].subject ? `: "${outbound[0].subject}"` : ""}.`);
    else parts.push("Nothing has been emailed to their address either — don't tell them we sent something.");
  }

  if (!sections.edits.ok) unreadable.push("their change history");
  else if (sections.edits.items.length) {
    const last = sections.edits.items[0];
    const landed = sections.edits.items.filter((e) => e.landed).length;
    parts.push(`Last change they asked for was ${ago(last.at, now)} — "${last.asked}" — and it ${last.landed ? "went live" : last.outcome === "refused" ? "was not something we could do" : "did not go through"}.`);
    parts.push(`${landed} of their last ${sections.edits.items.length} changes landed.`);
  } else {
    parts.push("They've never asked for a change before.");
  }

  if (!sections.uploads.ok) unreadable.push("their files");
  else if (sections.uploads.items.length) {
    const photos = sections.uploads.items.filter((u) => u.usable_on_site);
    if (photos.length) parts.push(`They've sent ${photos.length === 1 ? "one photo" : `${photos.length} photos`}, most recently ${ago(photos[0].at, now)} — usable on the site.`);
  }

  if (sections.siteChat.ok && sections.siteChat.items.length) {
    // Spoken aloud, so it has to be sayable: "1 people have used the chat"
    // appeared verbatim in the first live run against a real tenant.
    const n = sections.siteChat.items.length;
    const unread = sections.siteChat.items.filter((t) => t.unread).length;
    parts.push(`${n === 1 ? "One person has" : `${n} people have`} used the chat on their website${unread ? `, ${unread === n ? "still unread" : `${unread} still unread`}` : ""}.`);
  } else if (!sections.siteChat.ok) unreadable.push("their website messages");

  if (unreadable.length) {
    parts.push(`I can't see ${unreadable.join(" or ")} right now — if they ask about that, say so rather than guessing.`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// THE ONE ENTRY POINT
// ---------------------------------------------------------------------------

/**
 * readRileyContext({ scopeToken, siteSlug, select, now, fetchImpl, limits })
 *
 * -> { ok:true, site_slug, business_name, sections, spoken, read_at }
 *    { ok:false, status:404, error:"not_found" }
 *
 * `siteSlug` is OPTIONAL and is only ever a cross-check: supply it and it must
 * equal the slug inside the signature. It can never widen what is returned.
 */
async function readRileyContext({
  scopeToken,
  siteSlug,
  select = defaultSelect,
  now = Date.now(),
  fetchImpl = fetch,
  limits = SECTION_LIMITS,
} = {}) {
  const verified = verifyScopeToken(scopeToken);
  if (!verified || verified.ok !== true) return NOT_FOUND;
  const slug = String(verified.siteSlug || "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return NOT_FOUND;

  // A slug named in the request may only ever CONFIRM the signed one. A
  // mismatch is indistinguishable, from the outside, from a slug that does not
  // exist — deliberately.
  const asked = String(siteSlug || "").trim().toLowerCase();
  if (asked && asked !== slug) return NOT_FOUND;

  const cap = { ...SECTION_LIMITS, ...(isPlainObject(limits) ? limits : {}) };
  const tenant = await resolveTenant({ siteSlug: slug, select });

  const [emails, jobs, siteChat, uploads] = await Promise.all([
    readEmails({ tenant, select, limit: cap.emails }).catch(() => section(false, [], "The mail record could not be read just now.")),
    readJobs({ tenant, select, limit: cap.dashboard }).catch(() => ({ rows: null })),
    readSiteChat({ tenant, select, limit: cap.siteChat }).catch(() => section(false, [], "Their website's message log could not be read just now.")),
    readUploads({ tenant, limit: cap.uploads, fetchImpl }).catch(() => section(false, [], "Their uploaded files could not be listed just now.")),
  ]);

  const jobRows = jobs && Array.isArray(jobs.rows) ? jobs.rows : null;
  const channels = (jobs && jobs.channels) || new Map();
  const sections = {
    emails,
    dashboard: jobRows ? shapeDashboard(jobRows, channels, cap.dashboard) : section(false, [], "Their dashboard messages could not be read just now."),
    siteChat,
    edits: jobRows ? shapeEdits(jobRows, channels, cap.edits) : section(false, [], "Their change history could not be read just now."),
    uploads,
  };

  return {
    ok: true,
    site_slug: slug,
    business_name: tenant.business_name || null,
    // Named so a reader knows WHY an email section can be empty for a real
    // customer: without a single matched prospect row there is no address to
    // match mail against, and the honest report is "unidentified", not "none".
    identity: tenant.prospect_id ? "prospect_row" : (tenant.ambiguous ? "ambiguous" : "unidentified"),
    recent_days: RECENT_DAYS,
    read_at: new Date(now).toISOString(),
    sections,
    spoken: composeSpoken(sections, { now }),
  };
}

module.exports = {
  SECTION_LIMITS,
  RECENT_DAYS,
  priceLine,
  NOT_FOUND,
  resolveTenant,
  composeSpoken,
  shapeDashboard,
  shapeEdits,
  readRileyContext,
};
