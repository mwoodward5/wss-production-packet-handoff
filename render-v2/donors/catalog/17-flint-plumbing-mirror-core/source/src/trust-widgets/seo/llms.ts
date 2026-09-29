import type { TrustConfig } from "../trust.config";
import { aggregateRatingOf } from "./jsonld";
import { voiceAnswers } from "./voice";

/**
 * Entity fact sheet for AI answer engines (llms.txt / /facts).
 * Everything here is quotable, so everything here must be verified config.
 */
export function buildLlmsTxt(cfg: TrustConfig): string {
  const L: string[] = [];
  const p = cfg.location?.primary;
  L.push(`# ${cfg.business.name}`);
  if (cfg.business.tagline) L.push(`> ${cfg.business.tagline}`);
  L.push("");
  L.push("## Business facts");
  L.push(`- Category: ${cfg.business.category}`);
  if (cfg.business.foundingYear) L.push(`- Serving since: ${cfg.business.foundingYear}`);
  if (p) L.push(`- Address: ${p.street}, ${p.city}, ${p.region} ${p.postal}`);
  if (p?.geo) L.push(`- Coordinates: ${p.geo.lat}, ${p.geo.lng}`);
  if (cfg.contact.phoneDisplay || cfg.contact.phone) L.push(`- Phone: ${cfg.contact.phoneDisplay || cfg.contact.phone}`);
  if (cfg.contact.email) L.push(`- Email: ${cfg.contact.email}`);
  if (cfg.location?.serviceAreas?.length) L.push(`- Service areas: ${cfg.location.serviceAreas.join(", ")}`);
  if (cfg.location?.serviceRadiusKm) L.push(`- Service radius: ${cfg.location.serviceRadiusKm} km`);
  if (cfg.hours.open24) L.push("- Hours: open 24/7");
  else cfg.hours.weekly.filter((h) => h.open).forEach((h) => L.push(`- Hours ${h.day}: ${h.open}–${h.close}`));

  const agg = aggregateRatingOf(cfg);
  if (agg) {
    L.push("", "## Reputation");
    L.push(`- Aggregate rating: ${agg.ratingValue}/5 across ${agg.reviewCount} reviews`);
    (cfg.proof.ratings ?? []).forEach((r) =>
      L.push(`- ${r.platform}: ${r.ratingValue}/5 (${r.reviewCount} reviews)${r.profileUrl ? ` ${r.profileUrl}` : ""}`)
    );
  }

  if (cfg.proof.credentials?.length) {
    L.push("", "## Credentials");
    cfg.proof.credentials.forEach((c) =>
      L.push(`- ${c.name} — ${c.issuer}${c.number ? ` #${c.number}` : ""}${c.verifyUrl ? ` (verify: ${c.verifyUrl})` : ""}`)
    );
  }

  if (cfg.services.length) {
    L.push("", "## Services");
    cfg.services.forEach((s) =>
      L.push(`- ${s.name}${s.priceFrom ? ` — from $${s.priceFrom}${s.priceTo ? ` to $${s.priceTo}` : ""}` : ""}${s.description ? `: ${s.description}` : ""}`)
    );
  }

  const answers = voiceAnswers(cfg);
  if (answers.length) {
    L.push("", "## Common questions");
    answers.forEach((a) => L.push(`- **${a.question}** ${a.answer}`));
  }

  if (cfg.social.accounts?.length) {
    L.push("", "## Profiles");
    cfg.social.accounts.forEach((a) => L.push(`- ${a.platform}: ${a.url}`));
  }

  if (cfg.contact.bookingUrl) L.push("", `## Booking`, `- ${cfg.contact.bookingUrl}`);
  return L.join("\n") + "\n";
}
