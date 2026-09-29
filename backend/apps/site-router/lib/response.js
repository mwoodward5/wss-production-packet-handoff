"use strict";

const { RouterError } = require("./errors");
const { setNoStore } = require("./headers");

function end(res, statusCode, body = "") {
  const bytes = Buffer.from(body, "utf8");
  res.statusCode = statusCode;
  if (!res.hasHeader || !res.hasHeader("Content-Type")) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
  }
  res.setHeader("Content-Length", String(bytes.length));
  res.end(bytes);
}

function methodNotAllowed(res, allow) {
  res.setHeader("Allow", allow.join(", "));
  end(res, 405, "Method Not Allowed");
}

function fail(res, error, { preview = false } = {}) {
  if (res.headersSent || res.writableEnded) {
    if (typeof res.destroy === "function") res.destroy(error);
    return;
  }
  setNoStore(res, { preview });
  for (const header of [
    "Accept-Ranges",
    "Content-Range",
    "ETag",
    "X-WSS-Build-Hash",
    "X-WSS-Release-Id",
    "X-WSS-Route-Generation",
    "X-WSS-Site-Id"
  ]) res.removeHeader(header);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  const statusCode = error instanceof RouterError ? error.statusCode : 503;
  const body = statusCode === 404
    ? "Not Found"
    : statusCode === 400
      ? "Bad Request"
      : statusCode === 401
        ? "Unauthorized"
        : "Service Unavailable";
  end(res, statusCode, body);
}

module.exports = { end, fail, methodNotAllowed };
