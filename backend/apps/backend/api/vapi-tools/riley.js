"use strict";
// api/vapi-tools/riley.js — THE ONE AUTHENTICATED DOOR for Riley's voice tools.
//
// THE FAILURE THIS CLOSES. Each Vapi tool used to carry its own secret header
// inside the assistant config, checked by its own copy of the auth code on its
// own route. Deploys and secret rotation drifted those copies apart, and on a
// live call the SAME conversation produced lookup OK and site-edit-status 401 —
// five of seventeen tool calls lost while a customer was on the line, with
// nothing in any log to say the tools had quietly stopped sharing a secret.
//
// THE FIX. One endpoint authenticates ONCE against the single Vapi secret
// family (lib/vapi-auth.js — the same timingSafeEqual check every route used,
// implemented exactly once), reads which sub-tool the assistant invoked out of
// the payload, and dispatches to the tool cores as LIBRARY FUNCTIONS — no
// second HTTP hop, no second secret, no second copy of anything:
//
//   lookup_business_record -> lib/riley-lookup-core.js   (api/vapi-tools/lookup-prospect)
//   look_up_customer       -> lib/riley-context-core.js  (api/riley/context)
//   request_site_change    -> lib/site-edit-core.js      (api/vapi-tools/request-site-change)
//   site_edit_status       -> lib/edit-status-core.js    (api/vapi-tools/site-edit-status)
//   send_note              -> lib/riley-send-note-core.js(api/vapi-tools/send-note)
//   generate_poster        -> lib/riley-poster-core.js   (api/vapi-tools/generate-poster)
//
// One secret on the assistant, one URL on the assistant, one line in the log
// per call (lib/riley-telemetry.js) — a rotation or a deploy that breaks the
// voice lane now breaks it in ONE place, caught by scripts/riley-tools-smoke.js
// at deploy time instead of by a customer mid-call.
//
// The old routes stay up, unchanged in behavior, for assistants and probes that
// still point at them; they are thin transport shells over the same cores.

const { methodGuard, readJson, sendJson } = require("../../lib/http");
const { authorized } = require("../../lib/vapi-auth");
const { emitRileyToolCall } = require("../../lib/riley-telemetry");
const { lookupProspectCore } = require("../../lib/riley-lookup-core");
const { rileyContextCore } = require("../../lib/riley-context-core");
const { siteEditCore } = require("../../lib/site-edit-core");
const { siteEditStatusCore } = require("../../lib/edit-status-core");
const { sendNoteCore } = require("../../lib/riley-send-note-core");
const { posterCore } = require("../../lib/riley-poster-core");

const TOOLS = {
  lookup_business_record: { core: lookupProspectCore, route: "/api/vapi-tools/lookup-prospect" },
  look_up_customer: { core: rileyContextCore, route: "/api/riley/context" },
  request_site_change: { core: siteEditCore, route: "/api/vapi-tools/request-site-change" },
  site_edit_status: { core: siteEditStatusCore, route: "/api/vapi-tools/site-edit-status" },
  send_note: { core: sendNoteCore, route: "/api/vapi-tools/send-note" },
  generate_poster: { core: posterCore, route: "/api/vapi-tools/generate-poster" },
};

module.exports = async function handler(req, res) {
  const startedAt = Date.now();
  const emit = (tool, status, outcome) => emitRileyToolCall(process.env, {
    tool,
    status,
    outcome,
    ms: Date.now() - startedAt,
  });

  if (!methodGuard(req, res, ["POST"])) { emit("(none)", 405, "method_not_allowed"); return; }

  // The body is read BEFORE the auth decision so the unauthorized line can
  // name the tool that was denied. This is the drift-visibility contract: the
  // production failure surfaced as site_edit_status 401s while its siblings
  // answered, and a 401 logged as "(none)" would have hidden exactly that.
  // Parsing an unauthenticated body dispatches nothing.
  let tool = "(none)";
  let body = {};
  try {
    body = await readJson(req).catch(() => ({}));
    const peek = body?.message?.toolCalls?.[0];
    tool = String(peek?.function?.name || body.tool || body.name || "").trim().slice(0, 60) || "(none)";
  } catch { /* unparseable body: auth still decides, tool stays unnamed */ }

  if (!authorized(req)) {
    emit(tool, 401, "unauthorized");
    return sendJson(res, 401, { ok: false, error: "unauthorized" });
  }

  try {
    const entry = TOOLS[tool];
    if (!entry) {
      emit(tool, 400, "unknown_tool");
      return sendJson(res, 400, { ok: false, error: `unknown tool ${tool || "(none)"}`, tools: Object.keys(TOOLS) });
    }

    const out = await entry.core(body);
    emit(tool, out.status, out.status >= 200 && out.status < 300 ? "ok" : `http_${out.status}`);
    return sendJson(res, out.status, out.payload);
  } catch (error) {
    emit(tool, 500, "dispatch_error");
    return sendJson(res, 500, { ok: false, error: String((error && error.message) || error), status: "unavailable" });
  }
};

module.exports.TOOLS = TOOLS;
