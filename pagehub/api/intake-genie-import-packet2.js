"use strict";
const { timingSafeEqual } = require("node:crypto");
const { importPacket2 } = require("./lib/packet2-import");
function sameToken(supplied, expected) {
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function createHandler(deps = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }
    const expected = String((deps.env || process.env).INTAKE_GENIE_TOKEN || "");
    const supplied = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
    if (!expected) return res.status(503).json({ ok: false, error: "compiler_auth_unconfigured" });
    if (!sameToken(supplied, expected)) return res.status(401).json({ ok: false, error: "unauthorized" });
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ ok: false, error: "invalid_json" }); }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return res.status(400).json({ ok: false, error: "invalid_import" });
    try {
      const imported = await (deps.importPacket2 || importPacket2)(body, {
        harvestExactSourceUrls: deps.harvestExactSourceUrls, apiKey: (deps.env || process.env).FIRECRAWL_API_KEY,
      });
      if (!imported.ok) return res.status(imported.reason === "fresh_harvest_unavailable" ? 503 : 422)
        .json({ ok: false, error: imported.reason });
      return res.status(200).json({ ...imported.packet, transport_receipt: {
        version: "owner-packet2-import-v1", snapshot_sha256: imported.snapshot_sha256,
        packet2_hash: imported.packet.packet2_hash,
      } });
    } catch {
      return res.status(503).json({ ok: false, error: "packet2_import_unavailable" });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.config = { maxDuration: 300 };
