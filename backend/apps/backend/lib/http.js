const { createHash } = require("node:crypto");

// Browser CORS is only for the operator console and first-party apps. The
// wildcard `*` let any origin hit admin/billing/VAPI/OAuth routes, which is both
// a security and a cost-amplification surface. Webhooks (Stripe/Svix/Twilio) are
// server-to-server and never need a browser origin here.
const CORS_DEFAULT_ORIGIN = "https://ghost.wss-ai.com";
const CORS_ALLOWED_ORIGINS = new Set([
  "https://ghost.wss-ai.com",
  "https://wss-ai.com",
  "https://www.wss-ai.com",
  "https://connect.wss-labs.com",
  "https://getanswercrew.com",
  "https://www.getanswercrew.com",
]);

function allowedOrigin(origin) {
  const value = String(origin || "").trim();
  if (!value) return CORS_DEFAULT_ORIGIN;
  if (CORS_ALLOWED_ORIGINS.has(value)) return value;
  // Any *.wss-ai.com subdomain is a first-party surface.
  if (/^https:\/\/[a-z0-9-]+\.wss-ai\.com$/i.test(value)) return value;
  return CORS_DEFAULT_ORIGIN;
}

function setCors(res, origin = "") {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin(origin));
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Admin-Token,X-Requested-With,X-Vapi-Signature,X-Twilio-Signature,Stripe-Signature,Svix-Id,Svix-Timestamp,Svix-Signature,X-Cron-Secret,X-SiteForge-Token,X-LeadMiner-Signature,X-LeadMiner-Timestamp,X-LeadMiner-Event,X-LeadMiner-Project,X-LeadMiner-Delivery,X-LeadMiner-Idempotency-Key,X-LeadMiner-Schema-Version",
  );
}

function sendJson(res, statusCode, payload) {
  setCors(res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload, null, 2));
}

function methodGuard(req, res, methods) {
  setCors(res, req.headers && req.headers.origin);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return false;
  }
  if (!methods.includes(req.method)) {
    sendJson(res, 405, {
      ok: false,
      error: "method_not_allowed",
      allowed: methods,
    });
    return false;
  }
  return true;
}

async function readRawBody(req) {
  if (typeof req.body === "string") {
    return req.body;
  }
  if (req.body && Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }
  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readRawBody(req);
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    error.statusCode = 400;
    error.code = "invalid_json";
    error.rawPreview = raw.slice(0, 240);
    throw error;
  }
}

function hashObject(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function publicRequestUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}${req.url || ""}`;
}

function handleError(res, error) {
  const statusCode = error.statusCode || 500;
  sendJson(res, statusCode, {
    ok: false,
    error: error.code || "internal_error",
    message: error.message || String(error),
    rawPreview: error.rawPreview,
  });
}

module.exports = {
  handleError,
  hashObject,
  methodGuard,
  publicRequestUrl,
  readJson,
  readRawBody,
  sendJson,
  setCors,
};
