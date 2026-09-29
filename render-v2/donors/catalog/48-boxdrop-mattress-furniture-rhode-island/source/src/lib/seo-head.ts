import type { SeoPage } from "@/data/seoPages";
import { buildSchemas } from "@/lib/schema";

/**
 * Build TanStack Start head() output for a SeoPage.
 * Canonical / og:url are relative (resolve at request time against the live host).
 */
export function seoHeadForPage(page: SeoPage) {
  const schemas = buildSchemas(page);
  return {
    meta: [
      { title: page.title },
      { name: "description", content: page.description },
      { property: "og:title", content: page.title },
      { property: "og:description", content: page.description },
      { property: "og:type", content: page.type === "guide" ? "article" : "website" },
      { property: "og:url", content: page.path },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: page.title },
      { name: "twitter:description", content: page.description },
    ],
    links: [{ rel: "canonical", href: page.path }],
    scripts: schemas.map((s) => ({
      type: "application/ld+json",
      children: JSON.stringify(s),
    })),
  };
}
