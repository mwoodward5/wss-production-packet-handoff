export interface TrustBadge { label: string; image?: string; href?: string; }
export interface TrustConfig {
  licensed: boolean; insured: boolean; bonded: boolean;
  yearsInBusiness?: number; foundedYear?: number;
  badges: TrustBadge[]; certifications: string[];
  stats: { value: string; label: string }[];
}

export const TRUST: TrustConfig = {
  licensed: true,
  insured: true,
  bonded: false,
  badges: [
    {
      label: "BBB A+ Accredited",
      href: "https://www.bbb.org/us/mi/cadillac/profile/excavating-contractors/deuces-landscaping-excavation-llc-0372-38321255",
    },
    {
      label: "5-Star Reviewed on Google",
      href: "https://www.google.com/maps/place/DEUCES+Landscaping+%26+Excavation,+LLC/@44.3385975,-85.577725,11z/data=!4m8!3m7!1s0x613107ebb67e1a53:0xd1360054a8968696!8m2!3d44.3385975!4d-85.577725!9m1!1b1!16s%2Fg%2F11y9mdwl0_",
    },
  ],
  certifications: ["A+ BBB Accredited", "5-Star Reviewed on Google"],
  stats: [],
};
