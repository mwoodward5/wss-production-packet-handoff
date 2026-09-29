/**
 * /ai.txt — AI training/crawl policy.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CLIENT, SEO } from "@/config";

export const Route = createFileRoute("/ai.txt")({
  server: {
    handlers: {
      GET: async () => {
        const allow = SEO.robotsPolicy === "index";
        const body = [
          `# AI Crawl Policy for ${CLIENT.businessName}`,
          `# Updated: ${new Date().toISOString().slice(0, 10)}`,
          "",
          `User-Agent: *`,
          `Allow-AI-Training: ${allow ? "yes" : "no"}`,
          `Allow-AI-Search: ${allow ? "yes" : "no"}`,
          `Contact: ${CLIENT.email}`,
          "",
        ].join("\n");
        return new Response(body, {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
