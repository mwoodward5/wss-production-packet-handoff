"use strict";

const path = require("node:path");
const { MAX_ROUTE_LENGTH } = require("./constants");

function requestRoutePath(req) {
  // req.url is supplied by the single catch-all application entry point. Do
  // not accept query-derived route aliases: Vercel rewrite captures and client
  // query parameters share req.query and are therefore not a trust boundary.
  const url = req && typeof req.url === "string" && !Array.isArray(req.url)
    ? req.url
    : "/";
  return url.split("?", 1)[0] || "/";
}

function canonicalRoutePath(input) {
  if (typeof input !== "string" || !input.startsWith("/") || input.length > MAX_ROUTE_LENGTH) {
    return null;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(input) || input.includes("//")) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return null;
  }

  // One decoding pass must finish the job. Reject double encoding and encoded
  // separators instead of letting another layer reinterpret the route later.
  if (decoded.includes("%") || /[\\\u0000-\u001f\u007f?#]/.test(decoded) || decoded.includes("//")) {
    return null;
  }

  const segments = decoded.split("/");
  if (segments.some((segment, index) => index > 0 && (
    segment === "."
    || segment === ".."
    || (segment === "" && index !== segments.length - 1)
  ))) {
    return null;
  }

  if (path.posix.normalize(decoded) !== decoded) return null;

  const canonicalEncoded = encodeURI(decoded).replace(/%5B/g, "[").replace(/%5D/g, "]");
  if (canonicalEncoded !== input) return null;

  return decoded;
}

function canonicalFilePath(input) {
  if (typeof input !== "string" || !input || input.startsWith("/") || input.endsWith("/")) return null;
  const route = canonicalRoutePath(`/${input}`);
  return route && route.slice(1) === input ? input : null;
}

module.exports = { canonicalFilePath, canonicalRoutePath, requestRoutePath };
