/**
 * ┌── MIRROR:TEMPLATE-CODE — SUPPORT FILE ──────────────────────────────────
 * │ WHAT THIS FILE DOES: turns the two mirror config files into the system
 * │ prompt for the site's AI concierge (`/api/chat`).
 * │
 * │ WHO WRITES IT: nobody. This file is template code — it is IDENTICAL in
 * │ every mirrored client. It reads `trustConfig` + `clientConfig` at request
 * │ time, so the chatbot is automatically correct for whichever business the
 * │ mirroring engine dropped into those two files. There is NO per-client
 * │ prompt to write, and NO per-client API key: the whole fleet answers from
 * │ one Lovable AI key held on the server.
 * └──────────────────────────────────────────────────────────────────────────
 */
import { clientConfig, type ClientConfig } from "@/client.config";
import { trustConfig } from "@/trust.config";

type Cfg = typeof trustConfig;

function line(label: string, value?: string | number | null) {
  return value === undefined || value === null || value === "" ? "" : `${label}: ${value}\n`;
}

/**
 * Compact, factual brief. Keep it short — every token is billed on every
 * message, and the model only needs the facts already visible on the page.
 */
export function buildSiteBrief(cfg: Cfg = trustConfig, client: ClientConfig = clientConfig) {
  const b = cfg.business;
  const loc = cfg.location.primary;
  const rating = cfg.proof.ratings?.[0];

  let out = "";
  out += line("Business", b.name);
  out += line("What they do", b.category);
  out += line("About", b.description);
  out += line("Founded", b.foundingYear);
  out += line("Phone", cfg.contact.phoneDisplay);
  out += line("Text/SMS", cfg.contact.sms);
  out += line("Booking link", cfg.contact.bookingUrl);
  out += line("Quote link", cfg.contact.quoteUrl);
  out += line("Website", b.url);

  if (loc) {
    out += line(
      "Address",
      `${loc.street}, ${loc.city}, ${loc.region} ${loc.postal}${
        loc.geo ? ` (lat ${loc.geo.lat}, lng ${loc.geo.lng})` : ""
      }`,
    );
  }
  out += line("Service areas", cfg.location.serviceAreas?.join(", "));
  out += line(
    "Service radius",
    cfg.location.serviceRadiusKm ? `${Math.round(cfg.location.serviceRadiusKm * 0.621)} miles` : "",
  );

  if (cfg.hours.weekly?.length) {
    out +=
      "Hours:\n" +
      cfg.hours.weekly
        .map((h) => `  ${h.day}: ${h.open && h.close ? `${h.open}-${h.close}` : "Closed"}`)
        .join("\n") +
      "\n";
  }
  if (cfg.availability?.emergency?.available) {
    out += line("Emergency", cfg.availability.emergency.label);
  }

  if (cfg.services?.length) {
    out +=
      "Services:\n" +
      cfg.services
        .map(
          (s) =>
            `  - ${s.name}${s.priceFrom ? ` (from $${s.priceFrom})` : ""}${
              s.description ? `: ${s.description}` : ""
            }`,
        )
        .join("\n") +
      "\n";
  }

  if (rating) {
    out += line(
      "Reputation",
      `${rating.ratingValue} stars from ${rating.reviewCount} ${rating.platform} reviews`,
    );
  }
  if (cfg.proof.credentials?.length) {
    out +=
      "Credentials:\n" +
      cfg.proof.credentials.map((c) => `  - ${c.name} (${c.issuer ?? ""})`).join("\n") +
      "\n";
  }
  if (cfg.proof.guarantees?.length) {
    out +=
      "Guarantees:\n" +
      cfg.proof.guarantees.map((g) => `  - ${g.title}: ${g.detail ?? ""}`).join("\n") +
      "\n";
  }
  if (cfg.proof.reviews?.length) {
    out +=
      "Sample customer reviews:\n" +
      cfg.proof.reviews
        .slice(0, 4)
        .map((r) => `  - ${r.author} (${r.rating}/5): ${r.body.slice(0, 180)}`)
        .join("\n") +
      "\n";
  }
  out += line("Leave-a-review page", `${client.canonicalUrl}/#leave-a-review`);

  return out.trim();
}

export function buildSystemPrompt(cfg: Cfg = trustConfig, client: ClientConfig = clientConfig) {
  return `You are the AI concierge for ${cfg.business.name}, embedded on their website. You help homeowners and property managers decide what they need and how to reach the company.

RULES
- Answer ONLY from the FACTS block below. If a fact is not there, say you're not sure and point the visitor at the phone number.
- Never invent prices, arrival times, licence numbers, or availability.
- Keep answers short: 2-4 sentences, plain language. Plain text only: no markdown, no bullet points, no [link](url) syntax — write bare URLs.
- When the visitor describes an urgent problem (burst pipe, gas smell, flooding, no water), tell them to shut off the supply if safe and call ${cfg.contact.phoneDisplay ?? "the office"} immediately.
- Always end an actionable answer with the phone number or booking link.
- You are not able to book, dispatch, quote, or take payment. Hand those off.
- Speak in the first person plural ("we", "our team").

FACTS
${buildSiteBrief(cfg, client)}`;
}
