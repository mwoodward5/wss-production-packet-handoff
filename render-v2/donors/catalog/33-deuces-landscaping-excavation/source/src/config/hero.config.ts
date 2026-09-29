export interface HeroCta { label: string; href: string; }
export interface HeroConfig {
  eyebrow?: string;
  headline: string;
  subheadline: string;
  primaryCta: HeroCta;
  secondaryCta: HeroCta;
  video?: string; poster?: string;
  images: string[];
}

export const HERO: HeroConfig = {
  eyebrow: "Cadillac, MI · Excavation & Site Work",
  headline: "Cadillac's Go-To Company For Dirt Work and Machinery Needs",
  subheadline:
    "Professional excavation, demolition, landscaping and remodeling for Northern Michigan homeowners. Precision equipment work, handled with experience and accountability.",
  primaryCta: { label: "Contact us today to learn more", href: "/#contact" },
  secondaryCta: { label: "Message an expert", href: "tel:+12318788436" },
  images: [],
};
