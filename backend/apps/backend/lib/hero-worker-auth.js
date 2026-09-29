"use strict";

const crypto = require("node:crypto");
const { sendJson } = require("./http");

const WORKER_HEADER = "x-ghost-hero-worker-token";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Hash first so timingSafeEqual always compares fixed-size inputs. This keeps
// the worker credential check independent from the admin/session auth lane.
function safeTokenEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left || ""), "utf8").digest();
  const b = crypto.createHash("sha256").update(String(right || ""), "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

function requestWorkerToken(req = {}) {
  const headers = req && req.headers && typeof req.headers === "object" ? req.headers : {};
  const value = headers[WORKER_HEADER] ?? headers["X-Ghost-Hero-Worker-Token"];
  return Array.isArray(value) ? "" : clean(value);
}

function heroWorkerAuthState(env = process.env) {
  const workerToken = clean(env.GHOST_AGENCY_HERO_WORKER_TOKEN);
  if (!workerToken) return { configured: false, valid: false, reason: "server_worker_auth_unconfigured" };

  // Reusing an owner credential would collapse the security boundary this
  // module exists to enforce. Treat equality as a deployment error, not as an
  // intentional compatibility mode.
  const adminTokens = [
    clean(env.GHOST_AGENCY_ADMIN_TOKEN),
    clean(env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY),
  ].filter(Boolean);
  if (adminTokens.some((token) => safeTokenEqual(workerToken, token))) {
    return { configured: true, valid: false, reason: "worker_auth_credential_collision" };
  }
  return { configured: true, valid: true, token: workerToken };
}

function heroWorkerAllowed(req, env = process.env) {
  const state = heroWorkerAuthState(env);
  if (!state.valid) return { allowed: false, configured: state.configured, reason: state.reason };
  const supplied = requestWorkerToken(req);
  return {
    allowed: Boolean(supplied) && safeTokenEqual(supplied, state.token),
    configured: true,
    reason: supplied ? "unauthorized" : "worker_token_required",
  };
}

function requireHeroWorker(req, res, env = process.env) {
  const auth = heroWorkerAllowed(req, env);
  if (auth.allowed) return true;
  if (!auth.configured || auth.reason === "server_worker_auth_unconfigured") {
    sendJson(res, 503, { ok: false, error: "server_worker_auth_unconfigured" });
    return false;
  }
  if (auth.reason === "worker_auth_credential_collision") {
    sendJson(res, 503, { ok: false, error: "worker_auth_credential_collision" });
    return false;
  }
  sendJson(res, 401, { ok: false, error: "unauthorized" });
  return false;
}

module.exports = {
  WORKER_HEADER,
  safeTokenEqual,
  requestWorkerToken,
  heroWorkerAuthState,
  heroWorkerAllowed,
  requireHeroWorker,
};
