export interface SocialProfiles {
  facebook?: string; instagram?: string; linkedin?: string; twitter?: string;
  yelp?: string; bbb?: string; trustpilot?: string; tiktok?: string;
  youtube?: string; nextdoor?: string; googleMaps?: string; appleMaps?: string;
}

export const SOCIAL: SocialProfiles = {
  facebook: "https://www.facebook.com/p/Deuces-Landscaping-Excavation-LLC-61573434312385/",
  googleMaps: "https://www.google.com/maps/place/DEUCES+Landscaping+%26+Excavation,+LLC/@44.3385975,-85.577725,11z/data=!4m8!3m7!1s0x613107ebb67e1a53:0xd1360054a8968696!8m2!3d44.3385975!4d-85.577725!9m1!1b1!16s%2Fg%2F11y9mdwl0_",
  bbb: "https://www.bbb.org/us/mi/cadillac/profile/excavating-contractors/deuces-landscaping-excavation-llc-0372-38321255",
};

export function socialSameAs(): string[] {
  return Object.values(SOCIAL).filter((u): u is string => typeof u === "string" && u.length > 0);
}
