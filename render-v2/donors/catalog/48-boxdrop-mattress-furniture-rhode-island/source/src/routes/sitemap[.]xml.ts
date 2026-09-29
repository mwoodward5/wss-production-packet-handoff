import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { seoPages } from "@/data/seoPages";

// Canonical production domain — what crawlers redirect to and what Search Console
// is verified against. Do NOT use business.url here (that points at the lovable.app
// preview URL); search engines need the live host.
const BASE_URL = "https://mattressfurnitureoutletri.com";

type Priority = "1.0" | "0.9" | "0.85" | "0.8" | "0.7" | "0.6" | "0.5";

function priorityFor(p: { path: string; type: string }): Priority {
  if (p.path === "/") return "1.0";
  if (p.path === "/mattresses" || p.path === "/furniture") return "0.9";
  if (p.path === "/service-area") return "0.9";
  if (p.type === "location" || p.type === "near_me") return "0.85";
  if (p.type === "category") return "0.8";
  if (p.type === "guide") return "0.7";
  if (p.path === "/guides" || p.path === "/locations") return "0.7";
  return "0.5";
}

function changefreqFor(p: { type: string }): string {
  if (p.type === "guide") return "monthly";
  if (p.type === "category" || p.type === "location" || p.type === "near_me") return "weekly";
  return "monthly";
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        // Dedupe by path — generated "deep" pages overlay older shallow paths.
        const byPath = new Map<string, (typeof seoPages)[number]>();
        for (const p of seoPages) byPath.set(p.path, p);
        const sorted = [...byPath.values()].sort((a, b) => {
          const pa = parseFloat(priorityFor(a));
          const pb = parseFloat(priorityFor(b));
          return pb - pa;
        });

        const urls = sorted
          .map((p) =>
            [
              `  <url>`,
              `    <loc>${BASE_URL}${p.path === "/" ? "" : p.path}</loc>`,
              `    <lastmod>${p.lastmod}</lastmod>`,
              `    <changefreq>${changefreqFor(p)}</changefreq>`,
              `    <priority>${priorityFor(p)}</priority>`,
              `  </url>`,
            ].join("\n"),
          )
          .join("\n");

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
