"use strict";

const {
  PRIVATE_CACHE_CONTROL,
  PUBLIC_CACHE_CONTROL
} = require("./constants");

function setNoStore(res, { preview = false } = {}) {
  res.setHeader("Cache-Control", preview ? PRIVATE_CACHE_CONTROL : PUBLIC_CACHE_CONTROL);
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function setIdentityHeaders(res, release) {
  res.setHeader("X-WSS-Site-Id", release.siteId);
  res.setHeader("X-WSS-Release-Id", release.releaseId);
  res.setHeader("X-WSS-Build-Hash", release.buildHash);
  res.setHeader("X-WSS-Route-Generation", String(release.routeGeneration));
}

module.exports = { setIdentityHeaders, setNoStore };
