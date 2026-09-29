export interface SeoConfig {
  baseUrl: string;
  siteName: string;
  titleSuffix: string;
  defaultDescription: string;
  defaultOgImage: string;
  twitterHandle?: string;
  gscVerification?: string;
  bingVerification?: string;
  ga4Id?: string;
  gtmId?: string;
  clarityId?: string;
  indexnowKey?: string;
  robotsPolicy: "index" | "noindex";
  locale: string;
}

export const SEO: SeoConfig = {
  baseUrl: "https://ontheroadagain.wss-ai.com",
  siteName: "On The Road Again Mobile RV Service",
  titleSuffix: " | On The Road Again Mobile RV Service",
  defaultDescription:
    "Scheduled mobile RV service for RV owners in Middle Tennessee and the Nashville area.",
  defaultOgImage: "/og-default.jpg",
  gscVerification: "xrZLTAao94PyPYn9J0q0sNlMNyjynwXczjE8WsIQXkM",
  ga4Id: "G-GFX79JKY44",
  gtmId: "GTM-TKD5GWLK",
  robotsPolicy: "index",
  locale: "en_US",
};

export function absoluteUrl(path: string): string {
  const base = SEO.baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
