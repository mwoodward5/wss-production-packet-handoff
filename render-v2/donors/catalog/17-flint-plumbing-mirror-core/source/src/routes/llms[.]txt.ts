import { createFileRoute } from "@tanstack/react-router";

import { clientConfig } from "@/client.config";
import { trustConfig } from "@/trust.config";
import { voiceAnswers } from "@/trust-widgets/seo/voice";

/**
 * /llms.txt — the machine-readable brief for AI assistants and answer engines.
 * Same facts as the JSON-LD graph, in the plain-text shape LLM crawlers prefer.
 */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        const c = trustConfig;
        const loc = c.location.primary;
        const rating = c.proof.ratings?.[0];
        const lines: string[] = [
          `# ${c.business.name}`,
          "",
          `> ${c.business.description ?? c.business.tagline ?? ""}`,
          "",
          "## Facts",
          `- Category: ${c.business.category}`,
          c.business.foundingYear ? `- Founded: ${c.business.foundingYear}` : "",
          c.contact.phoneDisplay ? `- Phone: ${c.contact.phoneDisplay}` : "",
          loc ? `- Address: ${loc.street}, ${loc.city}, ${loc.region} ${loc.postal}` : "",
          loc?.geo ? `- Coordinates: ${loc.geo.lat}, ${loc.geo.lng}` : "",
          c.location.serviceAreas?.length
            ? `- Service area: ${c.location.serviceAreas.join(", ")}`
            : "",
          rating
            ? `- Rating: ${rating.ratingValue} from ${rating.reviewCount} ${rating.platform} reviews (verified ${rating.verifiedAt ?? "n/a"})`
            : "",
          c.contact.bookingUrl ? `- Book online: ${c.contact.bookingUrl}` : "",
          "",
          "## Hours",
          ...c.hours.weekly.map((h) =>
            `- ${h.day}: ${h.open && h.close ? `${h.open}–${h.close}` : "Closed"}`,
          ),
          "",
          "## Services",
          ...c.services.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`),
          "",
          "## Credentials",
          ...(c.proof.credentials ?? []).map(
            (cr) => `- ${cr.name} — ${cr.issuer}${cr.verifyUrl ? ` (${cr.verifyUrl})` : ""}`,
          ),
          "",
          "## Direct answers",
          ...voiceAnswers(c).flatMap((a) => [`### ${a.question}`, a.answer, ""]),
          "## Provenance",
          `- Canonical site: ${clientConfig.canonicalUrl}`,
          clientConfig.provenance.clientSiteUrl
            ? `- Operator site: ${clientConfig.provenance.clientSiteUrl}`
            : "",
          clientConfig.provenance.scrapedAt
            ? `- Facts verified: ${clientConfig.provenance.scrapedAt}`
            : "",
        ].filter(Boolean);

        return new Response(lines.join("\n"), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
