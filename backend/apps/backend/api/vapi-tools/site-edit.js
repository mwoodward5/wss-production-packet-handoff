"use strict";
// api/vapi-tools/site-edit.js — Vapi tool endpoint. Riley calls this mid-call
// when a customer asks for a website change.
//
// The tool itself lives in lib/site-edit-core.js so the ONE proxy door
// (api/vapi-tools/riley.js) can dispatch to it as a library function — one
// authentication for every tool, instead of one secret header per route to
// drift out from under a live call (the production incident where five of
// seventeen calls ran with lookup OK and status 401). This route keeps only
// the transport shell and answers exactly as before: auth, body parse, core,
// and the same 500 shape — envelope applied, as it always was, whenever the
// request carried a toolCallId.

const { authorized } = require("../../lib/vapi-auth");
const { siteEditCore } = require("../../lib/site-edit-core");

/** Same body handling as before: use the parsed object when present, else the raw stream. */
async function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return JSON.parse(await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d || "{}")); }));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end("method not allowed"); }
  if (!authorized(req)) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: "unauthorized" })); }
  let toolCallId = "";
  try {
    const body = await bodyOf(req);
    toolCallId = body?.message?.toolCalls?.[0]?.id || "";
    const out = await siteEditCore(body);
    res.setHeader("Content-Type", "application/json");
    res.statusCode = out.status;
    return res.end(JSON.stringify(out.payload));
  } catch (error) {
    res.statusCode = 500;
    const payload = { ok: false, error: String(error.message || error) };
    // A throw after a toolCallId was always enveloped here (the old res.end
    // wrapper applied to the catch path too); keep that binding exact.
    return res.end(JSON.stringify(toolCallId ? { results: [{ toolCallId, result: JSON.stringify(payload) }] } : payload));
  }
};

// Exported for the tests that pin the homework filter (and for
// api/vapi-tools/site-edit-status.js via lib/site-edit-core.js). The handler
// stays the default export so every existing caller and probe is untouched.
module.exports.asksCallerToDoTheFinding = require("../../lib/site-edit-core").asksCallerToDoTheFinding;
