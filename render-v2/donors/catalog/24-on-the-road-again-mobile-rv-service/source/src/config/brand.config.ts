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

export const BRAND: BrandConfig = {
  primary: "oklch(0.74 0.08 104)",
  secondary: "oklch(0.18 0 0)",
  accent: "oklch(0.74 0.08 104)",
  displayFont: "'Source Serif 4', Georgia, serif",
  bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
  heroVariant: "split-collage",
  logoLight: "/client/logo.png",
  logoDark: "/client/logo.png",
  favicon: "/client/logo.png",
  ogDefault: "/og-default.jpg",
  appleTouchIcon: "/client/logo.png",
};
