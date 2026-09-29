/**
 * /llms.txt — site summary for AI/LLM crawlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CLIENT, SEO, PROTECTED_SERVICE_TERMS } from "@/config";

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
          "",
          `## Pages`,
          `- [Home](${base}/)`,
          `- [Excavation](${base}/excavation)`,
          `- [Landscaping](${base}/landscaping)`,
          `- [Storm Cleanup](${base}/storm-cleanup)`,
          `- [Remodeling](${base}/remodeling)`,
          "",
          `## Services`,
          ...PROTECTED_SERVICE_TERMS.map((s) => `- ${s}`),
          "",
        ];
        return new Response(lines.join("\n"), {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
