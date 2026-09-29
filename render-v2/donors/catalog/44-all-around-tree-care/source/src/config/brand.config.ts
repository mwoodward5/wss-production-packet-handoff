import { DATA } from "@/wss/bridge";
export type HeroVariant = "cinematic-video" | "split-collage" | "parallax-stack";

export interface BrandConfig {
  primary: string;
  secondary: string;
  accent: string;
  displayFont: string;
  bodyFont: string;
  heroVariant: HeroVariant;
  logoLight: string;
  logoDark: string;
  favicon: string;
  ogDefault: string;
  appleTouchIcon: string;
}

// Preserve donor design DNA unless an explicit certified semantic role is supplied.
export const BRAND:BrandConfig={primary:'#FF9400',secondary:'#027731',accent:/^#[0-9a-f]{6}$/i.test(DATA.design.accent)?DATA.design.accent:'#D7B46A',displayFont:'"Playfair Display", Georgia, serif',bodyFont:'Inter, system-ui, sans-serif',heroVariant:'cinematic-video',logoLight:DATA.identity.logoOnLight,logoDark:DATA.identity.logoOnDark,favicon:DATA.identity.logoOnLight,ogDefault:DATA.hero.poster,appleTouchIcon:DATA.identity.logoOnLight};
