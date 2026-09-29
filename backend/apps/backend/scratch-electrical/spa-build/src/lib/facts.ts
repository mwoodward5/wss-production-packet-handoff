// Engine token access — the ONLY place a {{TOKEN}} literal may live in this
// source tree.
//
// Every placeholder is read through a Record lookup so the bundler cannot
// constant-fold the literal into surrounding copy before the engine
// substitutes it (the hvac-brandforge pattern, BOILERPLATE tokens_note).
// A value that still looks like an unhydrated placeholder is treated as
// ABSENT, so a raw donor preview collapses the same UI a blank fact does.
//
// REQUIRED tokens (BUSINESS_NAME, CITY, STATE, HERO_HEADLINE, ...) are never
// blank on a real build — the hydrator refuses the build first. OPTIONAL
// tokens collapse their own UI at runtime; no optional token literal may ever
// appear outside this file.

const RAW: Record<string, string> = {
  BUSINESS_NAME: "{{BUSINESS_NAME}}",
  PHONE: "{{PHONE}}",
  PHONE_DIGITS: "{{PHONE_DIGITS}}",
  EMAIL: "{{EMAIL}}",
  CITY: "{{CITY}}",
  STATE: "{{STATE}}",
  COUNTY: "{{COUNTY}}",
  PROFILE_URL: "{{PROFILE_URL}}",
  LICENSE: "{{LICENSE}}",
  LOGO_URL: "{{LOGO_URL}}",
  RATING: "{{RATING}}",
  REVIEW_COUNT: "{{REVIEW_COUNT}}",
  HERO_HEADLINE: "{{HERO_HEADLINE}}",
  HERO_LINE_A: "{{HERO_LINE_A}}",
  HERO_LINE_B: "{{HERO_LINE_B}}",
};

export const fact = (key: string): string => {
  const v = (RAW[key] || "").trim();
  if (v.startsWith("{{") || v.startsWith("[")) return "";
  return v;
};
