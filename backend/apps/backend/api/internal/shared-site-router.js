"use strict";

const {
  handleProxyRequest,
  publicError,
  readBoundedRawBody,
} = require("../../lib/shared-site-router-proxy");

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (status === 405) res.setHeader("Allow", "POST");
  // This private endpoint intentionally emits no Access-Control-Allow-* fields.
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  if (req?.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const rawBody = await readBoundedRawBody(req);
    const result = await handleProxyRequest({
      method: req.method,
      headers: req.headers,
      rawBody,
    });
    sendJson(res, result.status, result.body);
  } catch (error) {
    const result = publicError(error);
    sendJson(res, result.status, result.body);
  }
}

handler._test = { sendJson };

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
