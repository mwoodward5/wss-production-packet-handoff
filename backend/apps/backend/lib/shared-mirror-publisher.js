"use strict";

// One production boundary owns selection of the shared wildcard publisher.
// The Mirror Engine itself stays provider-free and only consumes an injected
// interface; every live entry point calls this helper before invoking it.

const { createDefaultSharedSitePublisher } = require("./shared-site-publisher");

let defaultPublisherInitialized = false;
let defaultPublisher = null;

function sharedMirrorDefaultEnabled(env = process.env) {
  // Exact "0" is the emergency return to the legacy per-site Vercel lane.
  // Missing, blank and every other value keep the shared default selected.
  return String(env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT || "") !== "0";
}

function refusingPublisher(error) {
  const reason = `shared_publisher_unavailable:${String(
    (error && error.message) || error || "unknown",
  ).slice(0, 160)}`;
  return Object.freeze({
    publish: async () => ({ ok: false, fallback: false, reason }),
  });
}

function liveSharedPublisher() {
  if (defaultPublisherInitialized) return defaultPublisher;
  defaultPublisherInitialized = true;
  try {
    defaultPublisher = createDefaultSharedSitePublisher();
  } catch (error) {
    // Once shared is selected, a missing adapter/configuration must fail closed.
    // It must never silently spend a per-site Vercel deployment instead.
    defaultPublisher = refusingPublisher(error);
  }
  return defaultPublisher;
}

function injectDefaultSharedPublisher(deps = {}, {
  env = process.env,
  dryRun = false,
  selectDefault = true,
} = {}) {
  const out = { ...(deps && typeof deps === "object" ? deps : {}) };

  // Explicit dependency injection always wins. The engine ignores publishers
  // during dry-run, so preserving one here is harmless and keeps tests honest.
  if (Object.prototype.hasOwnProperty.call(out, "sharedPublisher")) return out;
  if (dryRun || !selectDefault || !sharedMirrorDefaultEnabled(env)) return out;

  out.sharedPublisher = liveSharedPublisher();
  return out;
}

module.exports = {
  sharedMirrorDefaultEnabled,
  injectDefaultSharedPublisher,
};
