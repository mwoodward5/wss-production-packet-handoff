#!/usr/bin/env bun
/**
 * validate-schema — fails if required config fields are empty/placeholder.
 * Usage: bun run scripts/validate-schema.ts
 */
import { CLIENT, SEO, SERVICES } from "../src/config";

const errors: string[] = [];
const isPlaceholder = (v: unknown) =>
  typeof v === "string" && (v.includes("{{") || v === "" || v === "example.com" || v.includes("example.com"));

const required: Array<[string, unknown]> = [
  ["CLIENT.businessName", CLIENT.businessName],
  ["CLIENT.tagline", CLIENT.tagline],
  ["CLIENT.shortDescription", CLIENT.shortDescription],
  ["CLIENT.phone", CLIENT.phone],
  ["CLIENT.phoneE164", CLIENT.phoneE164],
  ["CLIENT.email", CLIENT.email],
  ["CLIENT.street", CLIENT.street],
  ["CLIENT.city", CLIENT.city],
  ["CLIENT.region", CLIENT.region],
  ["CLIENT.postalCode", CLIENT.postalCode],
  ["CLIENT.serviceAreaLabel", CLIENT.serviceAreaLabel],
  ["SEO.baseUrl", SEO.baseUrl],
  ["SEO.siteName", SEO.siteName],
  ["SEO.defaultDescription", SEO.defaultDescription],
];

for (const [name, value] of required) {
  if (isPlaceholder(value)) errors.push(`${name} is empty or placeholder ("${value}")`);
}
if (CLIENT.latitude === 0 || CLIENT.longitude === 0)
  errors.push("CLIENT.latitude/longitude must be set");
if (SEO.robotsPolicy !== "index")
  errors.push(`SEO.robotsPolicy is "${SEO.robotsPolicy}" — flip to "index" before publishing.`);
if (SERVICES.length === 0)
  errors.push("SERVICES is empty — add at least one service.");

if (errors.length) {
  console.error("✗ validate failed:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log("✓ validate passed — config is intake-complete.");
