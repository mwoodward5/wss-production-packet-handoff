"use strict";

// Durable producers write the same hero-reel job contract.  The local
// slideshow remains available only as an explicit operator choice or as a
// caller-owned fallback; it must never become the automatic line default.
const WAN_PRODUCER = "wan2_i2v_local";
const ADS_PRODUCER = "ads_image_to_video";
const OPENROUTER_SEEDANCE_PRODUCER = "openrouter_seedance";
const LEGACY_COMPOSE_PRODUCER = "hero_compose_local";
const DURABLE_HERO_PRODUCERS = Object.freeze([WAN_PRODUCER, ADS_PRODUCER, OPENROUTER_SEEDANCE_PRODUCER]);
const WAN_VERTICAL_ALIASES = Object.freeze({
  plumbing: "plumbing",
  hvac: "hvac",
  electrical: "electrical",
  roofing: "roofing",
  fencing: "fencing",
  concrete: "concrete",
  landscaping: "landscaping",
  "med spa": "med_spa",
  med_spa: "med_spa",
  "hair salon": "hair_salon",
  hair_salon: "hair_salon",
  tattoo: "tattoo",
  restoration: "restoration",
  "water damage restoration": "restoration",
  water_damage_restoration: "restoration",
  "general contractor": "general_contractor",
  general_contractor: "general_contractor",
  "home remodeling": "general_contractor",
  home_remodeling: "general_contractor",
});

function text(value) {
  return String(value ?? "").trim();
}

function isExplicitOff(value) {
  return /^(0|false|off|no)$/i.test(text(value));
}

function wanPrimaryEnabled(env = process.env) {
  // Ads Station is the safe line default. WAN is local/operator-owned compute
  // and must never be selected by an absent, empty, or unrecognized value.
  return /^(1|true|on|yes)$/i.test(text(env.GHOST_AGENCY_WAN_PRIMARY));
}

function seedancePrimaryEnabled(env = process.env) {
  // Seedance is the low-cost, browser-free line default. The kill switch is
  // deliberately explicit so an absent or malformed value cannot silently
  // turn the paid hero lane off.
  return !isExplicitOff(env.GHOST_AGENCY_SEEDANCE_PRIMARY);
}

function normalizeWanVertical(value) {
  const raw = text(value).toLowerCase().replace(/[\s-]+/g, " ");
  return WAN_VERTICAL_ALIASES[raw]
    || WAN_VERTICAL_ALIASES[raw.replace(/ /g, "_")]
    || "";
}

function defaultHeroProducer(env = process.env, vertical = "") {
  if (seedancePrimaryEnabled(env)) return OPENROUTER_SEEDANCE_PRODUCER;
  if (!wanPrimaryEnabled(env)) return ADS_PRODUCER;
  // A caller without row context retains the code-default. A caller that does
  // know the vertical must not send an unsupported trade into the wrong model
  // prompt; Ads remains the truthful durable fallback for that prospect.
  return text(vertical) && !normalizeWanVertical(vertical) ? ADS_PRODUCER : WAN_PRODUCER;
}

function heroAutolineEnabled(env = process.env) {
  return ![
    env.GHOST_AGENCY_HERO_AUTOLINE,
    env.GHOST_AGENCY_HERO_REMMASTER,
    env.GHOST_AGENCY_HERO_REMASTER,
  ].some(isExplicitOff);
}

function autolineHeroProducer(env = process.env, vertical = "") {
  return heroAutolineEnabled(env) ? defaultHeroProducer(env, vertical) : "";
}

function isDurableHeroProducer(value) {
  return DURABLE_HERO_PRODUCERS.includes(text(value));
}

function normalizeDurableHeroProducer(value, env = process.env) {
  const requested = text(value);
  // Queue/library callers without an explicit lane retain the legacy Ads
  // contract. Automatic line and API routing call defaultHeroProducer first
  // and therefore still select Seedance by default.
  if (!requested) return wanPrimaryEnabled(env) ? WAN_PRODUCER : ADS_PRODUCER;
  return isDurableHeroProducer(requested) ? requested : "";
}

function isLegacyComposeProducer(value) {
  return text(value) === LEGACY_COMPOSE_PRODUCER;
}

function resolveHeroProducer(value, options = {}) {
  const requested = text(value);
  const env = options.env || process.env;
  if (!requested) return defaultHeroProducer(env);
  if (isDurableHeroProducer(requested)) return requested;
  if (
    isLegacyComposeProducer(requested)
    && (options.explicit === true || options.fallback === true)
  ) return LEGACY_COMPOSE_PRODUCER;
  return "";
}

module.exports = {
  WAN_PRODUCER,
  ADS_PRODUCER,
  OPENROUTER_SEEDANCE_PRODUCER,
  LEGACY_COMPOSE_PRODUCER,
  DURABLE_HERO_PRODUCERS,
  WAN_VERTICAL_ALIASES,
  isExplicitOff,
  wanPrimaryEnabled,
  seedancePrimaryEnabled,
  defaultHeroProducer,
  normalizeWanVertical,
  heroAutolineEnabled,
  autolineHeroProducer,
  isDurableHeroProducer,
  normalizeDurableHeroProducer,
  isLegacyComposeProducer,
  resolveHeroProducer,
};
