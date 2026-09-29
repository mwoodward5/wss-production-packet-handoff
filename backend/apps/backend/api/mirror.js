"use strict";

// api/mirror.js — POST /api/mirror: the Mirror Engine endpoint.
//
// POST {slug, donor?, facts, brand?, hero?}   (strict — see mirror-request.schema.json)
//   ?dry_run=1  -> hydrate + scan + manifest + build_hash, ZERO Vercel calls.
// GET  ?slug=X  -> latest manifest for a slug (check status / revealable).
//
// Error codes (contract):
//   400 invalid_request            structurally malformed input
//   401/503                        admin auth (lib/admin-auth)
//   404 donor_not_found            unknown donor / no donor for vertical
//   404 donor_retired              donor is out of service (BOILERPLATE.retired);
//                                  refused by NAME and by vertical alike
//   409 slug_conflict              slug bound to a different business_name
//   422 missing_required_facts / invalid_facts / brand_asset_rejected /
//       unmapped_token             caller or donor-contract defects
//   500 donor_identity_detected / unhydrated_tokens /
//       hydration_parse_failed / deployed_verification_failed   engine defects
//   502 vercel_error               upstream deploy/alias failure
//
// HARD RULES: this endpoint never emails anyone; nothing downstream may treat
// a mirror as sendable without revealable:true in its manifest; deploy/alias
// stays inside the wss-test-* namespace until MIRROR_ALLOW_REAL_SLUGS=1.

const { requireAdmin } = require("../lib/admin-auth");
const { methodGuard, readJson, sendJson } = require("../lib/http");
const { mirror } = require("../lib/mirror-engine/engine");
const { defaultRegistry } = require("../lib/mirror-engine/build-hash");
const { applyDonorAlias } = require("../lib/donor-verticals");
const { injectDefaultSharedPublisher } = require("../lib/shared-mirror-publisher");

function createMirrorHandler(overrides = {}) {
  const runMirror = overrides.mirror || mirror;
  const authorize = overrides.requireAdmin || requireAdmin;
  const registry = overrides.registry || defaultRegistry;
  const baseDeps = overrides.deps && typeof overrides.deps === "object" ? overrides.deps : {};
  const env = overrides.env || process.env;

  return async (req, res) => {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!authorize(req, res)) return;

  const url = new URL(req.url, "https://localhost");

  if (req.method === "GET") {
    const slug = String(url.searchParams.get("slug") || "").trim();
    if (!slug) return sendJson(res, 400, { ok: false, error: "invalid_request", detail: [{ path: "/slug", message: "slug query param required" }] });
    const record = registry.recordGet(slug);
    if (!record) return sendJson(res, 404, { ok: false, error: "mirror_not_found", slug });
    return sendJson(res, 200, record);
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid_request", detail: [{ path: "/", message: "body is not valid JSON" }] });
  }

  const dryRun = ["1", "true"].includes(String(url.searchParams.get("dry_run") || "").toLowerCase());

  // VERTICAL ALIASES (data/donor-verticals.json). The engine resolves a donor
  // from facts.industry with one exact string compare against
  // BOILERPLATE.vertical, so adjacent verticals — "deck" for the fencing
  // donor, "masonry"/"hardscaping" for the concrete donor — had no route at
  // all. This names the donor explicitly on the way in; the engine's own
  // resolution and path-confinement then run completely unchanged.
  //
  // It never overrides a caller-supplied donor, and never fires for a vertical
  // the engine already owns. Retired verticals (roofing) have no alias, which
  // is what makes retiring them in the manifest actually stick.
  const aliased = applyDonorAlias(body);
  if (aliased.applied) body = aliased.body;

  try {
    const deps = injectDefaultSharedPublisher(baseDeps, {
      dryRun,
      env,
      selectDefault: runMirror === mirror,
    });
    const result = await runMirror(body, { dryRun, deps });
    if (aliased.applied && result.body && typeof result.body === "object") {
      result.body.donor_routed_by_alias = { industry: aliased.applied.industry, donor: aliased.applied.donor };
    }
    return sendJson(res, result.status, result.body);
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: "engine_error", detail: [{ reason: String(e && e.message ? e.message : e).slice(0, 300) }] });
  }
  };
}

module.exports = createMirrorHandler();
module.exports.createMirrorHandler = createMirrorHandler;
