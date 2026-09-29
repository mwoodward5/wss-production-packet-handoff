/**
 * Dynamic robots.txt — index in prod, noindex while template/preview.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { SEO } from "@/config";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const base = SEO.baseUrl.replace(/\/+$/, "");
        const body = SEO.robotsPolicy === "index"
          ? `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`
          : `User-agent: *\nDisallow: /\n`;
        return new Response(body, {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
