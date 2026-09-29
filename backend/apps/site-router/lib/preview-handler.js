"use strict";

const { requestAbortScope } = require("./abort");
const { readJsonBody } = require("./body");
const { serializedPreviewCookie } = require("./cookies");
const { badRequest, notFound, unauthorized, unavailable } = require("./errors");
const { siteHostFromRequest } = require("./host");
const { sharedSiteEnvironment } = require("./environment");
const { setNoStore } = require("./headers");
const { fail, methodNotAllowed } = require("./response");
const { assertStore } = require("./store");
const {
  mintPreviewSession,
  signingSecret,
  verifyPreviewGrant
} = require("./token");

function hasUrlParameters(req) {
  try {
    return new URL(req.url || "/api/preview-session", "https://router.invalid").search.length > 0;
  } catch {
    return true;
  }
}

function createPreviewSessionHandler({
  store,
  env = process.env,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  randomId
}) {
  const deploymentEnv = sharedSiteEnvironment(env);
  return async function previewSessionHandler(req, res) {
    setNoStore(res, { preview: true });
    const abortScope = requestAbortScope(req, res);
    try {
      const siteHost = siteHostFromRequest(req);
      if (!siteHost) throw notFound();

      const method = String(req.method || "GET").toUpperCase();
      if (method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      if (hasUrlParameters(req)) throw badRequest("preview_token_must_not_be_in_url");

      const contentType = req.headers && req.headers["content-type"];
      if (typeof contentType === "string" && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
        throw badRequest();
      }

      const body = await readJsonBody(req, abortScope.signal);
      if (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body).length !== 1
          || typeof body.grant !== "string") {
        throw badRequest();
      }

      const secret = signingSecret(env);
      if (!secret || !deploymentEnv) throw unavailable("preview_not_configured");
      const now = nowSeconds();
      const grant = verifyPreviewGrant(body.grant, {
        env: deploymentEnv,
        nowSeconds: now,
        secret
      });
      if (!grant || grant.slug !== siteHost.slug) throw unauthorized("invalid_preview_grant");

      const consumed = await assertStore(store).consumePreviewGrant(grant, {
        signal: abortScope.signal
      });
      if (consumed !== true) throw unauthorized("invalid_preview_grant");

      const session = mintPreviewSession(grant, {
        nowSeconds: now,
        randomId,
        secret
      });
      res.statusCode = 204;
      res.setHeader("Set-Cookie", serializedPreviewCookie(session));
      res.setHeader("Content-Length", "0");
      res.end();
    } catch (error) {
      fail(res, error, { preview: true });
    } finally {
      abortScope.cleanup();
    }
  };
}

module.exports = { createPreviewSessionHandler, hasUrlParameters };
