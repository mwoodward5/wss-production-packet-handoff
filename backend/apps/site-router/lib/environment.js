"use strict";

const ENV_RE = /^[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?$/;

function exactEnvironment(value) {
  if (typeof value !== "string" || value !== value.trim() || !ENV_RE.test(value)) return null;
  return value;
}

/**
 * WSS_SHARED_SITE_ENV is the sole environment identity for publisher, grants,
 * registry RPCs, and the router. WSS_SITE_ROUTER_ENV is accepted only as a
 * temporary duplicate assertion; it is never a fallback source.
 */
function sharedSiteEnvironment(env = process.env) {
  const canonicalRaw = env && env.WSS_SHARED_SITE_ENV;
  const routerRaw = env && env.WSS_SITE_ROUTER_ENV;
  const canonical = exactEnvironment(canonicalRaw);
  const router = routerRaw === undefined ? null : exactEnvironment(routerRaw);

  if (routerRaw !== undefined && (!router || !canonical || router !== canonical)) {
    throw new Error("shared_site_environment_mismatch");
  }
  if (canonicalRaw !== undefined && !canonical) {
    throw new Error("shared_site_environment_invalid");
  }
  return canonical;
}

module.exports = { exactEnvironment, sharedSiteEnvironment };
