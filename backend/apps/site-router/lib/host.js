"use strict";

const { BASE_DOMAIN, RESERVED_SLUGS } = require("./constants");

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function scalarHeader(value) {
  if (Array.isArray(value)) return "";
  return typeof value === "string" ? value.trim() : "";
}

function stripPort(host) {
  const match = /^(.*):([0-9]{1,5})$/.exec(host);
  if (!match) return host;
  const port = Number(match[2]);
  return port > 0 && port <= 65535 ? match[1] : "";
}

function parseSiteHost(value) {
  const original = scalarHeader(value);
  if (!original || original.length > 253 || /[\s,@/\\]/.test(original)) return null;

  const host = stripPort(original.toLowerCase());
  if (!host || host.endsWith(".")) return null;

  const suffix = `.${BASE_DOMAIN}`;
  if (!host.endsWith(suffix)) return null;

  const slug = host.slice(0, -suffix.length);
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return null;

  return Object.freeze({ host, slug });
}

function siteHostFromRequest(req) {
  return parseSiteHost(req && req.headers && req.headers.host);
}

module.exports = { parseSiteHost, siteHostFromRequest };
