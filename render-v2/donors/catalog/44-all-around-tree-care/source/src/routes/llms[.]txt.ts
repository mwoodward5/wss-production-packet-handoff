import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CLIENT, SEO, SERVICES } from "@/config";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        const base = SEO.baseUrl.replace(/\/+$/, "");
        const lines: string[] = [
          `# ${CLIENT.businessName}`,
          "",
          `> ${CLIENT.shortDescription}`,
          "",
          `Location: ${CLIENT.city}, ${CLIENT.region}`,
          `Service Area: ${CLIENT.serviceAreaLabel}`,
          `Phone: ${CLIENT.phone}`,
          `Email: ${CLIENT.email}`,
          `Owner: ${CLIENT.ownerName ?? ""}`,
          "",
          `## Key Pages`,
          `- [Home](${base}/)`,
          `- [Services](${base}/services)`,
          `- [Tree Removal & Tree Care](${base}/tree-removal)`,
          `- [Lawn Care & Landscaping](${base}/lawn-landscaping)`,
          `- [Contact](${base}/contact)`,
          "",
          `## Services`,
          ...SERVICES.map((s) => `- [${s.name}](${base}${s.route}) — ${s.shortDesc}`),
          "",
        ];
        return new Response(lines.join("\n"), {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
