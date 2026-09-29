"use strict";

// api/riley/context.js — Riley's eyes. One read, no writes, no new verbs.
//
// WHY IT LIVES HERE AND NOT IN api/vapi-tools/. That directory is being worked
// on in parallel; a second author adding a file to it is how a merge quietly
// drops a security check. This is a NEW route with the same auth as its
// siblings, and the one-line change that lets Riley reach it is a tool
// definition in VAPI plus (optionally) one require in the existing tools. No
// existing file is touched.
//
// The tool itself now lives in lib/riley-context-core.js so it can also be
// dispatched as a library function by the ONE proxy door
// (api/vapi-tools/riley.js) — one authentication for every tool, instead of
// one secret header per route to drift out from under a live call. This route
// keeps only the transport shell and answers exactly as before.

const { authorized } = require("../../lib/vapi-auth");
const { rileyContextCore } = require("../../lib/riley-context-core");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end("method not allowed"); }
  if (!authorized(req)) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: "unauthorized" })); }

  let toolCallId = "";
  try {
    let body = req.body;
    if (!body || typeof body !== "object") {
      body = JSON.parse(await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d || "{}")); }));
    }
    toolCallId = body?.message?.toolCalls?.[0]?.id || "";

    const out = await rileyContextCore(body);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = out.status;
    return res.end(JSON.stringify(out.payload));
  } catch (error) {
    res.statusCode = 500;
    const payload = { ok: false, error: String((error && error.message) || error).slice(0, 200) };
    // A throw after a toolCallId was always enveloped here (the old res.end
    // wrapper applied to the catch path too); keep that binding exact.
    return res.end(JSON.stringify(toolCallId ? { results: [{ toolCallId, result: JSON.stringify(payload) }] } : payload));
  }
};
