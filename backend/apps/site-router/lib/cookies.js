"use strict";

const { PREVIEW_COOKIE, PREVIEW_SESSION_MAX_AGE_SECONDS } = require("./constants");

function previewCookieState(req) {
  const header = req && req.headers && req.headers.cookie;
  if (typeof header !== "string") return Object.freeze({ present: false, value: null });
  if (header.length > 8192) return Object.freeze({ present: true, value: null });
  const matches = [];
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === PREVIEW_COOKIE) {
      matches.push(part.slice(index + 1).trim());
    }
  }
  return Object.freeze({
    present: matches.length > 0,
    value: matches.length === 1 && matches[0] ? matches[0] : null
  });
}

function serializedPreviewCookie(value) {
  return `${PREVIEW_COOKIE}=${value}; Max-Age=${PREVIEW_SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

module.exports = { previewCookieState, serializedPreviewCookie };
