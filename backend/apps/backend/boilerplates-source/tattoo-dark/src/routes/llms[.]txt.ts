import { createFileRoute } from "@tanstack/react-router";
import { siteConfig } from "@/config/siteConfig";

// Generated from siteConfig at request time — never a static donor artifact.
// Every fact here must trace back to a verified siteConfig field.
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const firstName = siteConfig.artistName.split(" ")[0];
        const hoursLine = siteConfig.hours
          .map((h) => `${h.day} ${h.open}–${h.close}`)
          .join(", ");

        const body = `# ${siteConfig.studioName} — ${siteConfig.tagline}

${siteConfig.studioName} is a private, appointment-only studio in ${siteConfig.neighborhood || siteConfig.city} owned and operated by ${siteConfig.artistName}. ${siteConfig.bio}

## Location
${siteConfig.address}.

## Hours
${hoursLine}. Closed ${siteConfig.closedDays.join(" and ")}.

## Contact
- Website: ${origin}
- Booking form: ${origin}/#booking
- Phone: ${siteConfig.phone}
- Email: ${siteConfig.email}
- Instagram: ${siteConfig.instagram}

## Pricing
- Deposit: ${siteConfig.pricing.deposit} (applies to final cost, non-refundable)
- Studio minimum: ${siteConfig.pricing.minimum}
- Hourly rate: ${siteConfig.pricing.hourly}
${siteConfig.pricingBands.map((b) => `- ${b.size}: ${b.range}`).join("\n")}

## Services
${siteConfig.services.map((s) => `- ${s.name}`).join("\n")}

## Booking Process
1. Submit the request form with placement, size, style, budget, and references.
2. ${firstName} reviews every request personally within 3 business days.
3. Approved requests receive available dates and a deposit link.
4. Final artwork is drawn for your anatomy before your appointment.

## Policies
${siteConfig.policies.map((p) => `- ${p}`).join("\n")}

## Sitemap
- / — Home
- /artist — About ${firstName}
- /portfolio — Full gallery
- /flash — Flash designs
- /process — How booking works, pricing, aftercare
- /faq — Frequently asked questions
- /visit — Location, hours, directions, parking
`;
        return new Response(body, {
          headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
