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

export const SOCIAL: SocialProfiles = {
  yelp: "https://www.yelp.com/biz/on-the-road-again-mobile-rv-repair-service-hendersonville-2",
  googleMaps:
    "https://www.google.com/maps/place/On+The+Road+Again+Mobile+RV+Service/data=!4m2!3m1!1s0x0:0x600afc304909f147?sa=X&ved=1t:2428&ictx=111",
};

export function socialSameAs(): string[] {
  return Object.values(SOCIAL).filter((u): u is string => typeof u === "string" && u.length > 0);
}
