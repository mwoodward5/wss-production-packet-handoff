import { DATA } from "@/wss/bridge";
export interface SocialProfiles {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  yelp?: string;
  bbb?: string;
  trustpilot?: string;
  tiktok?: string;
  youtube?: string;
  nextdoor?: string;
  googleMaps?: string;
  appleMaps?: string;
}

export const SOCIAL:SocialProfiles={googleMaps:DATA.trust.mapUrl||undefined};
export function socialSameAs():string[]{return [...DATA.trust.socials];}
