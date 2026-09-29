/**
 * BRAND.CONFIG.TS — DEUCES brand tokens.
 */
export type HeroVariant = "cinematic-video" | "split-collage" | "parallax-stack" | "typographic";

export interface BrandConfig {
  primary: string; secondary: string; accent: string;
  displayFont: string; bodyFont: string;
  heroVariant: HeroVariant;
  logoLight: string; logoDark: string; favicon: string;
  ogDefault: string; appleTouchIcon: string;
}

export const BRAND: BrandConfig = {
  // Deuces palette: #F4DA16 yellow, #808080 grey, #3F3F3F charcoal, #000000 black
  primary: "oklch(0.88 0.18 95)",       // yellow
  secondary: "oklch(0.30 0 0)",         // charcoal
  accent: "oklch(0.88 0.18 95)",
  displayFont: "'Oswald', 'Inter', system-ui, sans-serif",
  bodyFont: "'Inter', system-ui, sans-serif",
  heroVariant: "typographic",
  logoLight: "/logo.png",
  logoDark: "/logo.png",
  favicon: "/favicon.png",
  ogDefault: "/og-default.jpg",
  appleTouchIcon: "/apple-touch-icon.png",
};
