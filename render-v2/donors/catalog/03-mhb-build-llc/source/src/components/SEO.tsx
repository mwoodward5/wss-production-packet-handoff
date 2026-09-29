import { client } from "@/lib/bridge";
import { useEffect } from "react";
import { business } from "@/lib/business";

interface SEOProps {
  title: string;
  description: string;
  path?: string;
  image?: string;
  imageAlt?: string;
  schema?: Record<string, any> | Record<string, any>[];
}

const SITE = business.url;
const DEFAULT_OG = new URL(client.hero.poster, SITE).href;

export const SEO = ({ title, description, path = "/", image, imageAlt, schema }: SEOProps) => {
  useEffect(() => {
    document.title = title;
    const url = `${SITE}${path}`;
    const ogImage = image || DEFAULT_OG;
    const ogAlt =
      imageAlt ||
      business.name;

    const setMeta = (selector: string, attr: string, value: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement("meta");
        const [, key, val] = selector.match(/\[(.+?)="(.+?)"\]/) || [];
        if (key && val) el.setAttribute(key, val);
        document.head.appendChild(el);
      }
      el.setAttribute(attr, value);
    };

    setMeta('meta[name="description"]', "content", description);

    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:url"]', "content", url);
    setMeta('meta[property="og:type"]', "content", "website");
    setMeta('meta[property="og:site_name"]', "content", business.name);
    setMeta('meta[property="og:locale"]', "content", "en_US");
    setMeta('meta[property="og:image"]', "content", ogImage);
    setMeta('meta[property="og:image:alt"]', "content", ogAlt);

    setMeta('meta[name="twitter:card"]', "content", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);
    setMeta('meta[name="twitter:image"]', "content", ogImage);
    setMeta('meta[name="twitter:image:alt"]', "content", ogAlt);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;

    document.head.querySelectorAll("script[data-seo-jsonld]").forEach((n) => n.remove());
    if (schema) {
      const items = Array.isArray(schema) ? schema : [schema];
      items.forEach((s) => {
        const tag = document.createElement("script");
        tag.type = "application/ld+json";
        tag.setAttribute("data-seo-jsonld", "true");
        tag.text = JSON.stringify(s);
        document.head.appendChild(tag);
      });
    }
  }, [title, description, path, image, imageAlt, schema]);

  return null;
};
