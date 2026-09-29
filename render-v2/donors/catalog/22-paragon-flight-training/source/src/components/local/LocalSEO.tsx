import { useEffect } from "react";
import { SITE } from "@/data/local";

interface LocalSEOProps {
  title: string;
  description: string;
  path: string; // e.g. "/flight-school/cape-coral"
  keywords?: string;
  /** Extra JSON-LD nodes to merge into the @graph (Service, Course, FAQPage, etc.) */
  graph?: Record<string, unknown>[];
  /** Speakable CSS selectors (default works for our LocalPage layout). */
  speakableSelectors?: string[];
  /** Breadcrumb trail (final item = current page). */
  breadcrumbs: { name: string; path: string }[];
}

/**
 * Per-page SEO + JSON-LD with Speakable schema for voice / AI-answer surfaces.
 * Mounted by each landing page; cleans up on unmount so SPA nav stays clean.
 */
export const LocalSEO = ({
  title,
  description,
  path,
  keywords,
  graph = [],
  speakableSelectors = ["[data-speakable]", "h1"],
  breadcrumbs,
}: LocalSEOProps) => {
  const url = `${SITE.url}${path}`;

  useEffect(() => {
    document.title = title;

    const setMeta = (name: string, content: string, attr: "name" | "property" = "name") => {
      let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("description", description);
    if (keywords) setMeta("keywords", keywords);
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("og:type", "website", "property");
    setMeta("og:url", url, "property");
    setMeta("og:site_name", SITE.name, "property");
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);

    let canon = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canon) {
      canon = document.createElement("link");
      canon.rel = "canonical";
      document.head.appendChild(canon);
    }
    canon.href = url;

    const ldId = "ld-page";
    document.getElementById(ldId)?.remove();
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.id = ldId;
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "@id": `${url}#webpage`,
          url,
          name: title,
          description,
          inLanguage: "en-US",
          isPartOf: { "@id": `${SITE.url}/#website` },
          speakable: {
            "@type": "SpeakableSpecification",
            cssSelector: speakableSelectors,
          },
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: breadcrumbs.map((b, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: b.name,
            item: `${SITE.url}${b.path}`,
          })),
        },
        ...graph,
      ],
    });
    document.head.appendChild(ld);

    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });

    return () => {
      document.getElementById(ldId)?.remove();
    };
  }, [title, description, url, keywords, JSON.stringify(graph), JSON.stringify(breadcrumbs), JSON.stringify(speakableSelectors)]);

  return null;
};
