import { DATA } from "@/wss/bridge";
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

export const SEO:SeoConfig={baseUrl:DATA.identity.website,siteName:DATA.identity.businessName,titleSuffix:` - ${DATA.identity.businessName}`,defaultDescription:DATA.hero.support,defaultOgImage:DATA.hero.poster,robotsPolicy:'noindex',locale:'en_US'};
export function absoluteUrl(path:string):string{return new URL(path,SEO.baseUrl).href;}
