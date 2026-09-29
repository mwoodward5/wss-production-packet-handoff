"use strict";

const BASE_DOMAIN = "wss-ai.com";
const MANIFEST_SCHEMA = "wss-site-release/v1";
const PUBLIC_CACHE_CONTROL = "public, no-store, max-age=0, s-maxage=0, must-revalidate";
const PRIVATE_CACHE_CONTROL = "private, no-store, max-age=0, must-revalidate";
const PREVIEW_GRANT_AUDIENCE = "wss-site-router-preview";
const PREVIEW_SESSION_AUDIENCE = "wss-site-router-preview-session";
const PREVIEW_COOKIE = "__Host-wss-site-preview";
const PREVIEW_GRANT_MAX_AGE_SECONDS = 5 * 60;
// A consumed grant may open only one short inspection window. Keep the browser
// session no longer-lived than the grant it replaces so the cookie cannot
// silently extend preview access after the one-use exchange.
const PREVIEW_SESSION_MAX_AGE_SECONDS = 5 * 60;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_RANGE_BYTES = 8 * 1024 * 1024;
// V1 deliberately verifies every object before it writes response headers.
// Keep the largest possible allocation bounded until the storage provider can
// supply a cryptographically trusted immutable-version checksum contract.
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_ROUTE_LENGTH = 4096;

const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "cdn",
  "connect",
  "console",
  "email",
  "ghost",
  "gallery",
  "campaigns",
  "docs",
  "help",
  "labs",
  "ledger",
  "line",
  "mail",
  "preview",
  "static",
  "status",
  "support",
  "replies",
  "www"
]);

module.exports = Object.freeze({
  BASE_DOMAIN,
  MANIFEST_SCHEMA,
  MAX_ASSET_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_RANGE_BYTES,
  MAX_ROUTE_LENGTH,
  PREVIEW_COOKIE,
  PREVIEW_GRANT_AUDIENCE,
  PREVIEW_GRANT_MAX_AGE_SECONDS,
  PREVIEW_SESSION_AUDIENCE,
  PREVIEW_SESSION_MAX_AGE_SECONDS,
  PRIVATE_CACHE_CONTROL,
  PUBLIC_CACHE_CONTROL,
  RESERVED_SLUGS
});
