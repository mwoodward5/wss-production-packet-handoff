"use strict";

const { canonicalRoutePath, requestRoutePath } = require("./path");
const { setNoStore } = require("./headers");
const { end } = require("./response");
const { createSiteHandler } = require("./site-handler");
const { createPreviewSessionHandler } = require("./preview-handler");
const { HEALTH_PATH, createHealthHandler } = require("./health-handler");

const PREVIEW_SESSION_PATH = "/api/preview-session";

function refuseInternalPath(res) {
  setNoStore(res);
  end(res, 404, "Not Found");
}

/**
 * Single catch-all application entry point. Vercel forwards the original URL
 * path to this handler, so route identity comes from req.url rather than a
 * rewrite-created/client-controlled query parameter. There is no /api/site
 * function for clients to invoke directly.
 */
function createRouterApplication({ store, env = process.env, nowSeconds, randomId } = {}) {
  const siteHandler = createSiteHandler({ store, env, nowSeconds });
  const previewHandler = createPreviewSessionHandler({ store, env, nowSeconds, randomId });
  const healthHandler = createHealthHandler({ store });
  return async function routerApplication(req, res) {
    const rawPath = requestRoutePath(req);
    if (rawPath === HEALTH_PATH) return healthHandler(req, res);
    if (rawPath === PREVIEW_SESSION_PATH) return previewHandler(req, res);

    const canonical = canonicalRoutePath(rawPath);
    if (!canonical
        || canonical === "/api"
        || canonical.startsWith("/api/")
        || canonical === "/_wss"
        || canonical.startsWith("/_wss/")) {
      refuseInternalPath(res);
      return;
    }
    return siteHandler(req, res);
  };
}

module.exports = { HEALTH_PATH, PREVIEW_SESSION_PATH, createRouterApplication };
