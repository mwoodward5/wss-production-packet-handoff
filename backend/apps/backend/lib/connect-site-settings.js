"use strict";

/**
 * lib/connect-site-settings.js — what the owner decided about his own bubble.
 *
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * One row per mirror in `connect_site_settings`, keyed on `site_slug` — the only
 * identity the widget and the public chat endpoints ever hold. It answers five
 * questions and nothing else:
 *
 *   ai_chat_enabled   may an assistant answer on this site at all
 *   takeover_seconds  how long a human gets to grab the conversation first
 *   custom_qa         answers the owner typed himself
 *   booking_url       where "book me in" should send someone
 *   greeting          the first line the bubble opens with
 *
 * ai_chat_enabled DEFAULTS TRUE, and the absence of a row is a complete,
 * valid state — every column has a default. The owner opts a site OUT; he never
 * has to opt one in, and no site needs provisioning before its bubble works.
 *
 * WHY custom_qa IS DIFFERENT FROM EVERYTHING ELSE IN THE GROUNDING LAYER
 * ---------------------------------------------------------------------------
 * lib/connect-site-kb.js exists to guarantee the assistant can only repeat what
 * the client's own site already publishes. custom_qa is the single exception,
 * and it is a deliberate one: a human being wrote the answer, on purpose, about
 * his own business. That is a better authority than a scrape, not a worse one.
 * It is the thing that made GoHighLevel's bot feel like it knew the business.
 *
 * It is still not a licence to print tokens. An owner who types
 * "{{business_name}} is open late" expecting substitution would have those
 * braces read aloud to a customer, so an answer carrying unresolved template
 * syntax is refused BY NAME rather than stored and spoken. See REFUSALS.
 *
 * THE FAILURE POSTURE, WHICH IS NOT SYMMETRIC
 * ---------------------------------------------------------------------------
 *   · no row            -> defaults. The bot may speak. This is the normal case.
 *   · store unreachable -> ai_chat_enabled FALSE, reason named.
 *   · table missing     -> ai_chat_enabled FALSE, reason named.
 *
 * Defaulting to "on" when the store is DOWN would let a site the owner
 * explicitly switched off start talking again during a database blip. An
 * opt-out that a network error can undo is not an opt-out. Silence costs a
 * captured lead; the other direction costs a customer's trust, and this system
 * has already paid that bill more than once.
 */

const { SLUG_RE } = require("./mirror-lead");
const { select: defaultSelect, upsertRow: defaultUpsertRow } = require("./store");

const TABLE = "connect_site_settings";

const DEFAULTS = Object.freeze({
  aiChatEnabled: true,
  takeoverSeconds: 30,
  customQa: Object.freeze([]),
  bookingUrl: "",
  greeting: "",
});

const LIMITS = Object.freeze({
  takeoverSecondsMax: 600,
  customQaPairs: 50,
  questionChars: 300,
  answerChars: 1500,
  greetingChars: 300,
  urlChars: 2048,
});

/**
 * Template syntax in every flavour this codebase has shipped. Kept in step with
 * lib/mirror-engine/place-names.js TEMPLATE_CHARS, but narrower on purpose:
 * this one is applied to PROSE a human typed, where angle brackets and pipes
 * are ordinary punctuation and only an unresolved placeholder is a defect.
 */
const TEMPLATE_TOKEN = /\{\{|\}\}|\$\{|%%[A-Za-z0-9_]+%%|__[A-Z][A-Z0-9_]{2,}__|<%[-=]?\s/;

const trim = (v) => String(v == null ? "" : v).trim();

/** Refuses an over-long value rather than truncating it into somebody else's
 * slug. Same rule, and the same reason, as normalizeSlug in connect-site-kb.js. */
function normalizeSlug(value) {
  const slug = trim(value).toLowerCase();
  return slug.length <= 80 && SLUG_RE.test(slug) ? slug : "";
}

/** Unresolved placeholder syntax in text a customer would be shown. */
function hasUnresolvedToken(value) {
  return TEMPLATE_TOKEN.test(trim(value));
}

function normalizeTakeoverSeconds(value, fallback = DEFAULTS.takeoverSeconds) {
  const parsed = Number.parseInt(String(value == null ? "" : value).trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > LIMITS.takeoverSecondsMax) return LIMITS.takeoverSecondsMax;
  return parsed;
}

/**
 * A booking link the bubble may hand to a stranger. https only: the widget is
 * served over https, so an http destination is a mixed-content dead end, and
 * javascript:/data: in a link we render for a customer is not a booking page in
 * any reading. Refusal is named, never a silent drop.
 */
function normalizeBookingUrl(value) {
  const raw = trim(value).slice(0, LIMITS.urlChars);
  if (!raw) return { url: "", reason: "" };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: "", reason: "booking_url_unparseable" };
  }
  if (parsed.protocol !== "https:") return { url: "", reason: `booking_url_not_https:${parsed.protocol.replace(":", "")}` };
  if (hasUnresolvedToken(raw)) return { url: "", reason: "booking_url_unresolved_template_token" };
  return { url: parsed.toString(), reason: "" };
}

function normalizeGreeting(value) {
  const raw = trim(value).replace(/\s+/g, " ").slice(0, LIMITS.greetingChars);
  if (!raw) return { greeting: "", reason: "" };
  if (hasUnresolvedToken(raw)) return { greeting: "", reason: "greeting_unresolved_template_token" };
  return { greeting: raw, reason: "" };
}

/**
 * Owner-typed question/answer pairs, held to the one bar that survives being
 * spoken to a customer. Returns `{ pairs, refusals }` — nothing is dropped
 * silently, because a pair the owner believes he saved and that the bot never
 * uses is worse than a rejected write.
 */
function normalizeCustomQa(value) {
  const list = Array.isArray(value) ? value : [];
  const pairs = [];
  const refusals = [];
  for (const entry of list) {
    if (pairs.length >= LIMITS.customQaPairs) {
      refusals.push({ question: "", reason: "custom_qa_limit_reached" });
      break;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      refusals.push({ question: "", reason: "custom_qa_entry_not_an_object" });
      continue;
    }
    const question = trim(entry.question || entry.q).replace(/\s+/g, " ").slice(0, LIMITS.questionChars);
    const answer = trim(entry.answer || entry.a).slice(0, LIMITS.answerChars);
    if (!question || !answer) {
      refusals.push({ question, reason: "custom_qa_needs_question_and_answer" });
      continue;
    }
    if (hasUnresolvedToken(question) || hasUnresolvedToken(answer)) {
      refusals.push({ question, reason: "custom_qa_unresolved_template_token" });
      continue;
    }
    pairs.push({ question, answer });
  }
  return { pairs, refusals };
}

function readRows(result) {
  if (Array.isArray(result)) return { ok: true, rows: result };
  if (result && result.ok === true && Array.isArray(result.data)) return { ok: true, rows: result.data };
  if (result && result.mode === "live_select" && Array.isArray(result.rows)) return { ok: true, rows: result.rows };
  return { ok: false, rows: [], result };
}

/**
 * PostgREST's dialect for "you are asking about a table that does not exist".
 * Worth telling apart from a network failure: one means "apply
 * sql/connect_site_kb.sql", the other means "the database is having a moment",
 * and an operator reading a log should not have to guess which.
 */
function tableMissing(result) {
  const status = Number(result && result.status);
  const error = (result && result.error) || {};
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  if (code === "42P01" || code === "PGRST205") return true;
  return status === 404 && /(does not exist|could not find the table|relation)/.test(message);
}

function defaultsFor(slug, { source, reason } = {}) {
  return {
    ok: true,
    slug,
    exists: false,
    aiChatEnabled: DEFAULTS.aiChatEnabled,
    takeoverSeconds: DEFAULTS.takeoverSeconds,
    customQa: [],
    bookingUrl: "",
    greeting: "",
    refusals: [],
    source: source || "defaults",
    reason: reason || "",
  };
}

function disabledFor(slug, reason) {
  return {
    ...defaultsFor(slug, { source: "unavailable", reason }),
    ok: false,
    aiChatEnabled: false,
  };
}

function fromRow(slug, row) {
  const qa = normalizeCustomQa(row.custom_qa);
  const booking = normalizeBookingUrl(row.booking_url);
  const greeting = normalizeGreeting(row.greeting);
  return {
    ok: true,
    slug,
    exists: true,
    // Anything other than an explicit false is enabled: a column that is null
    // because it predates this migration must behave like the default, not
    // like an opt-out nobody chose.
    aiChatEnabled: row.ai_chat_enabled !== false,
    takeoverSeconds: normalizeTakeoverSeconds(row.takeover_seconds),
    customQa: qa.pairs,
    bookingUrl: booking.url,
    greeting: greeting.greeting,
    refusals: [
      ...qa.refusals,
      ...(booking.reason ? [{ field: "booking_url", reason: booking.reason }] : []),
      ...(greeting.reason ? [{ field: "greeting", reason: greeting.reason }] : []),
    ],
    source: "connect_site_settings",
    reason: "",
    updatedAt: trim(row.updated_at).slice(0, 40),
  };
}

/**
 * readSiteSettings(slug) -> settings
 *
 * Never throws. Every outcome carries `source` and `reason` so a caller can say
 * why the bot is quiet instead of shrugging.
 */
async function readSiteSettings(siteSlug, { select = defaultSelect } = {}) {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return disabledFor(trim(siteSlug).slice(0, 80), "invalid_site_slug");

  let raw;
  try {
    raw = await select(TABLE, `select=*&site_slug=eq.${encodeURIComponent(slug)}&limit=2`);
  } catch (error) {
    return disabledFor(slug, `settings_unavailable:${String(error && error.message || "read_failed").slice(0, 60)}`);
  }

  const found = readRows(raw);
  if (!found.ok) {
    return disabledFor(slug, tableMissing(found.result) ? "settings_table_missing" : "settings_unavailable");
  }

  // The primary key makes two rows impossible, so a second row means we are not
  // reading the table we think we are. Refuse rather than pick.
  if (found.rows.length > 1) return disabledFor(slug, "settings_ambiguous_rows");

  const row = found.rows[0];
  if (!row) return defaultsFor(slug, { source: "defaults", reason: "no_row_for_site" });
  if (normalizeSlug(row.site_slug) !== slug) return disabledFor(slug, "settings_row_slug_mismatch");
  return fromRow(slug, row);
}

/**
 * writeSiteSettings(slug, patch) -> { ok, slug, written, refusals, reason }
 *
 * Only the keys present in `patch` are written. Note the upsert argument order:
 * upsertRow(table, ROW, conflictColumns). Getting that wrong is how three
 * earlier writes in this codebase silently did nothing at all.
 */
async function writeSiteSettings(siteSlug, patch = {}, { upsertRow = defaultUpsertRow, now = () => new Date() } = {}) {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return { ok: false, slug: "", written: null, refusals: [], reason: "invalid_site_slug" };

  const row = { site_slug: slug, updated_at: now().toISOString() };
  const refusals = [];

  if (Object.prototype.hasOwnProperty.call(patch, "aiChatEnabled")) {
    row.ai_chat_enabled = patch.aiChatEnabled !== false;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "takeoverSeconds")) {
    row.takeover_seconds = normalizeTakeoverSeconds(patch.takeoverSeconds);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "customQa")) {
    const qa = normalizeCustomQa(patch.customQa);
    row.custom_qa = qa.pairs;
    refusals.push(...qa.refusals.map((r) => ({ field: "custom_qa", ...r })));
  }
  if (Object.prototype.hasOwnProperty.call(patch, "bookingUrl")) {
    const booking = normalizeBookingUrl(patch.bookingUrl);
    row.booking_url = booking.url || null;
    if (booking.reason) refusals.push({ field: "booking_url", reason: booking.reason });
  }
  if (Object.prototype.hasOwnProperty.call(patch, "greeting")) {
    const greeting = normalizeGreeting(patch.greeting);
    row.greeting = greeting.greeting || null;
    if (greeting.reason) refusals.push({ field: "greeting", reason: greeting.reason });
  }

  let result;
  try {
    result = await upsertRow(TABLE, row, "site_slug");
  } catch (error) {
    return { ok: false, slug, written: null, refusals, reason: `settings_write_failed:${String(error && error.message || "").slice(0, 60)}` };
  }
  const mode = String(result && result.mode || "");
  if (mode !== "live_upsert") {
    return {
      ok: false,
      slug,
      written: null,
      refusals,
      reason: mode === "dry_run" ? "store_not_configured" : `settings_write_failed:${mode || "unknown"}`,
    };
  }
  return { ok: true, slug, written: row, refusals, reason: "" };
}

module.exports = {
  DEFAULTS,
  LIMITS,
  TABLE,
  hasUnresolvedToken,
  normalizeBookingUrl,
  normalizeCustomQa,
  normalizeGreeting,
  normalizeTakeoverSeconds,
  readSiteSettings,
  writeSiteSettings,
  _test: { TEMPLATE_TOKEN, defaultsFor, disabledFor, fromRow, normalizeSlug, readRows, tableMissing },
};
