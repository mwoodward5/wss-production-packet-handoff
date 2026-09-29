"use strict";

const { setNoStore } = require("./headers");
const { methodNotAllowed } = require("./response");

const HEALTH_PATH = "/_wss/health";
const SERVICE_NAME = "wss-shared-site-router";

function storeIsReady(store) {
  if (!store || typeof store.isReady !== "function") return false;
  try {
    return store.isReady() === true;
  } catch {
    return false;
  }
}

function createHealthHandler({ store } = {}) {
  return function healthHandler(req, res) {
    setNoStore(res);
    const method = String(req && req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      methodNotAllowed(res, ["GET", "HEAD"]);
      return;
    }

    const ready = storeIsReady(store);
    const body = Buffer.from(JSON.stringify({
      ok: ready,
      service: SERVICE_NAME,
      status: ready ? "ready" : "not_ready"
    }), "utf8");
    res.statusCode = ready ? 200 : 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", String(body.length));
    res.end(method === "HEAD" ? undefined : body);
  };
}

module.exports = {
  HEALTH_PATH,
  SERVICE_NAME,
  createHealthHandler,
  storeIsReady
};
