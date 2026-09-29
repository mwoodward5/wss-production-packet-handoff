import { createFileRoute } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";
import { SERVICES, CITIES } from "@/lib/services-data";

const STATIC_URLS = ["/", "/services", "/tree-removal-stump-grinding", "/emergency-tree-service", "/service-area", "/about", "/contact"];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const today = new Date().toISOString().split("T")[0];
        const allUrls = [
          ...STATIC_URLS,
          ...SERVICES.filter((s) => s.path.startsWith("/services/")).map((s) => s.path),
          ...CITIES.map((c) => c.path),
        ];
        const urlset = allUrls
          .map(
            (u) =>
              `<url><loc>https://${BUSINESS.domain}${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${u === "/" ? "1.0" : "0.8"}</priority></url>`
          )
          .join("");
        const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlset}</urlset>`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
