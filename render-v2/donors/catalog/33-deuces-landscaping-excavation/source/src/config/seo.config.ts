/**
 * SEO.CONFIG.TS — DEUCES site-level SEO.
 */
export interface SeoConfig {
  baseUrl: string; siteName: string; titleSuffix: string;
  defaultDescription: string; defaultOgImage: string;
  twitterHandle?: string; gscVerification?: string; bingVerification?: string;
  ga4Id?: string; gtmId?: string; clarityId?: string; indexnowKey?: string;
  robotsPolicy: "index" | "noindex"; locale: string;
}

export const SEO: SeoConfig = {
  baseUrl: "https://deuceslandscapingexcavationllc.com",
  siteName: "DEUCES Landscaping & Excavation, LLC",
  titleSuffix: " — DEUCES Landscaping & Excavation",
  defaultDescription:
    "DEUCES Landscaping & Excavation, LLC — professional excavation, demolition, landscaping and remodeling for Cadillac and Northern Michigan. A+ BBB accredited, 5-star reviewed on Google.",
  defaultOgImage: "/og-default.jpg",
  gtmId: "GTM-KP8BRBFT",
  ga4Id: "G-NYSJHKV202",
  robotsPolicy: "index",
  locale: "en_US",
};

export function absoluteUrl(path: string): string {
  const base = SEO.baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
