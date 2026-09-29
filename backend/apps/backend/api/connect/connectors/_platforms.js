// Shared mapping between legacy frontend platform IDs and backend OAuth providers.

"use strict";

const LEGACY_TO_PROVIDER = {
  facebook_messenger: "facebook",
  instagram_dm: "instagram",
  linkedin_messaging: "linkedin",
  twitter_dm: "twitter",
  tiktok_dm: "tiktok",
  google_voice: null,
  google_chat: null,
  craigslist: null,
};

const PROVIDER_TO_LEGACY = {
  facebook: ["facebook_messenger"],
  instagram: ["instagram_dm"],
  linkedin: ["linkedin_messaging"],
  twitter: ["twitter_dm"],
  tiktok: ["tiktok_dm"],
};

function getLegacyPlatformIds() {
  return Object.keys(LEGACY_TO_PROVIDER);
}

function getProviderForLegacy(platformId) {
  return LEGACY_TO_PROVIDER[String(platformId || "").trim()];
}

function getProviderForConnectorRoute(platformId) {
  const key = String(platformId || "").trim();
  const legacyProvider = getProviderForLegacy(key);
  if (legacyProvider) return legacyProvider;
  return PROVIDER_TO_LEGACY[key] ? key : null;
}

function canonicalCallbackPlatform(platformId) {
  const key = String(platformId || "").trim();
  if (key === "facebook_messenger" || key === "facebook") return "facebook";
  if (key === "instagram_dm" || key === "instagram") return "instagram";
  if (key === "linkedin_messaging" || key === "linkedin") return "linkedin";
  if (key === "twitter_dm" || key === "twitter") return "twitter";
  if (key === "tiktok_dm" || key === "tiktok") return "tiktok";
  return "";
}

function legacyIdsForProvider(provider) {
  return PROVIDER_TO_LEGACY[String(provider || "").trim()] || [];
}

module.exports = {
  getLegacyPlatformIds,
  getProviderForLegacy,
  getProviderForConnectorRoute,
  canonicalCallbackPlatform,
  legacyIdsForProvider,
};
