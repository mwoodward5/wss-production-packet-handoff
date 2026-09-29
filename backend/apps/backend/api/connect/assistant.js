"use strict";

/**
 * /api/connect/assistant — the owner's own settings for the chat bubble on his
 * own site, plus a read-only view of what the assistant has been doing.
 *
 *   GET   -> { ok, slug, settings, activity, limits }
 *   POST  -> { ok, slug, settings, refusals }   (only the keys you send)
 *
 * THE SCOPE RULE, WHICH IS THE WHOLE SECURITY MODEL
 * ---------------------------------------------------------------------------
 * The slug comes from the SIGNED TOKEN. Never from the query string, never from
 * the body. This is the same enforcement as api/connect/send.js:88 and for the
 * same reason — a tenant must not be able to read, write, or even confirm the
 * existence of another business's configuration.
 *
 * A tenant who names a slug that is not his own gets 404, not 403. 403 would
 * confirm the slug exists and merely belongs to someone else, which turns this
 * endpoint into a directory of every customer we have. 404 is indistinguishable
 * from a slug that was never real, so a probe learns nothing either way.
 *
 * A full/admin token (the operator console) is the deliberate asymmetry: it may
 * act on any site, but it must SAY which one. There is no implicit "current
 * site" for an operator, because an operator misfire lands on a real customer.
 *
 * WHY WRITES CANNOT SILENTLY PARTIALLY SUCCEED
 * ---------------------------------------------------------------------------
 * lib/connect-site-settings.js returns `refusals` — a booking link that was not
 * https, a Q&A pair carrying an unresolved {{token}}. Those are passed straight
 * through to the caller and rendered in the panel. The owner has to be told
 * which of the things he just typed was not kept; a save that reports success
 * while quietly dropping one of his answers is the exact defect that makes a
 * settings page untrustworthy.
 */

const { resolveConnectScope } = require("../../lib/connect");
const { readPublicBody } = require("../../lib/connect-chat");
const { readSiteSettings, writeSiteSettings, LIMITS } = require("../../lib/connect-site-settings");
const { readAssistantActivity } = require("../../lib/connect-assistant-activity");
const { recordEvent } = require("../../lib/store");

// Generous next to a chat message, and still bounded. The documented ceiling is
// 50 pairs of (300 + 1500) characters, so a cap below ~90 KB would make a limit
// we advertise unreachable — a refusal the owner could never explain.
const BODY_CAP_BYTES = 192 * 1024;

const ALLOWED_ORIGINS = ["https://wss-ai.com", "https://www.wss-ai.com", "https://connect.wss-labs.com"];

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}

function notFound(res) {
  return json(res, 404, { ok: false, error: "not_found" });
}

function requestedSlug(req, body) {
  const fromQuery = (() => {
    try {
      return new URL(req.url || "", "https://ghost.wss-ai.com").searchParams.get("slug") || "";
    } catch {
      return "";
    }
  })();
  return String(fromQuery || (body && body.slug) || "").trim().toLowerCase();
}

/**
 * The one place a slug is decided. Returns { slug } or { deny } — and `deny` is
 * always the response to send, already chosen, so no caller can accidentally
 * turn a scope failure into a 200.
 */
function resolveSlug(scope, req, body, res) {
  const named = requestedSlug(req, body);
  if (scope.mode === "tenant") {
    const own = String(scope.siteSlug || "").trim().toLowerCase();
    if (!own) return { deny: () => notFound(res) };
    // Naming your own site is fine and is what the dashboard does not do.
    // Naming anyone else's is a probe, and gets the same answer as a slug that
    // does not exist.
    if (named && named !== own) return { deny: () => notFound(res) };
    return { slug: own };
  }
  if (!named) return { deny: () => json(res, 400, { ok: false, error: "slug_required_for_admin_scope" }) };
  return { slug: named };
}

/** Only the five keys are writable, and only when actually present. Passing the
 * whole body through would let a caller set columns we never meant to expose. */
function patchFrom(body) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, "aiChatEnabled")) patch.aiChatEnabled = body.aiChatEnabled !== false;
  if (Object.prototype.hasOwnProperty.call(body, "takeoverSeconds")) patch.takeoverSeconds = body.takeoverSeconds;
  if (Object.prototype.hasOwnProperty.call(body, "customQa")) patch.customQa = body.customQa;
  if (Object.prototype.hasOwnProperty.call(body, "bookingUrl")) patch.bookingUrl = body.bookingUrl;
  if (Object.prototype.hasOwnProperty.call(body, "greeting")) patch.greeting = body.greeting;
  return patch;
}

/** The owner sees his settings; he does not need our storage vocabulary. */
function settingsView(settings) {
  return {
    aiChatEnabled: settings.aiChatEnabled === true,
    takeoverSeconds: settings.takeoverSeconds,
    customQa: settings.customQa || [],
    bookingUrl: settings.bookingUrl || "",
    greeting: settings.greeting || "",
    // `available` is false when the store could not be read — the panel then
    // says so instead of drawing defaults as though they were the owner's
    // choices. A missing ROW is not this: that is a real, complete answer.
    available: settings.ok === true,
    reason: settings.reason || "",
  };
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });
  const scope = resolveConnectScope(req);
  if (!scope) return json(res, 401, { ok: false, error: "unauthorized" });

  try {
    let body = {};
    if (req.method === "POST") {
      try {
        body = await readPublicBody(req, BODY_CAP_BYTES);
      } catch (error) {
        if (String(error && error.code) === "request_body_too_large") {
          return json(res, 413, { ok: false, error: "request_body_too_large" });
        }
        throw error;
      }
    }

    const resolved = resolveSlug(scope, req, body, res);
    if (resolved.deny) return resolved.deny();
    const slug = resolved.slug;

    if (req.method === "GET") {
      const [settings, activity] = await Promise.all([
        readSiteSettings(slug),
        readAssistantActivity(slug).catch(() => ({ available: false, reason: "activity_failed", replies: [], week: null })),
      ]);
      return json(res, 200, {
        ok: true,
        slug,
        settings: settingsView(settings),
        refusals: settings.refusals || [],
        activity,
        limits: {
          customQaPairs: LIMITS.customQaPairs,
          questionChars: LIMITS.questionChars,
          answerChars: LIMITS.answerChars,
          greetingChars: LIMITS.greetingChars,
          takeoverSecondsMax: LIMITS.takeoverSecondsMax,
        },
      });
    }

    const patch = patchFrom(body);
    if (!Object.keys(patch).length) return json(res, 400, { ok: false, error: "nothing_to_change" });

    const written = await writeSiteSettings(slug, patch);
    if (!written.ok) {
      return json(res, 502, {
        ok: false,
        error: "settings_not_saved",
        reason: written.reason || "",
        refusals: written.refusals || [],
      });
    }

    // Read back rather than echo the patch. What the owner is shown after a save
    // is what the store now holds, so a value normalization (or a refusal) is
    // visible immediately instead of on his next visit.
    const settings = await readSiteSettings(slug);
    await Promise.resolve(recordEvent("connect_assistant_settings_saved", {
      siteSlug: slug,
      scope: scope.mode,
      fields: Object.keys(patch),
      refused: (written.refusals || []).length,
    })).catch(() => {});

    return json(res, 200, {
      ok: true,
      slug,
      settings: settingsView(settings),
      // Refusals from the WRITE, which are the ones about what the owner just
      // typed. The read-back's own refusals would repeat them a beat later.
      refusals: written.refusals || [],
    });
  } catch {
    return json(res, 500, { ok: false, error: "assistant_settings_failed" });
  }
};

module.exports._test = { patchFrom, requestedSlug, resolveSlug, settingsView };
