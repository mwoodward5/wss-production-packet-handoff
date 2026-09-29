/** Design tokens. Override any subset; widgets read CSS vars, so this can be applied at runtime. */
export interface TrustTheme {
  bg: string; surface: string; surfaceAlt: string; line: string;
  text: string; textMuted: string; accent: string; accentText: string;
  star: string; positive: string; danger: string;
  radius: string; radiusLg: string; fontHeading: string; fontBody: string;
  shadow: string; maxWidth: string;
}

export const darkTheme: TrustTheme = {
  bg: "#0b0b0c", surface: "#141416", surfaceAlt: "#1c1c20", line: "#2a2a30",
  text: "#f4f1ea", textMuted: "#b3aea4", accent: "#e2483c", accentText: "#ffffff",
  star: "#f5b544", positive: "#4ec38a", danger: "#e2483c",
  radius: "10px", radiusLg: "18px",
  fontHeading: "'Fraunces', Georgia, serif", fontBody: "'Inter Tight', system-ui, sans-serif",
  shadow: "0 18px 50px rgba(0,0,0,.45)", maxWidth: "1200px",
};

export const lightTheme: TrustTheme = {
  bg: "#ffffff", surface: "#f7f6f3", surfaceAlt: "#efece6", line: "#dcd8d0",
  text: "#15161a", textMuted: "#5d6067", accent: "#1f5fd6", accentText: "#ffffff",
  star: "#e0a318", positive: "#1c9a63", danger: "#c8372c",
  radius: "10px", radiusLg: "18px",
  fontHeading: "'Fraunces', Georgia, serif", fontBody: "'Inter Tight', system-ui, sans-serif",
  shadow: "0 12px 34px rgba(15,18,25,.12)", maxWidth: "1200px",
};

const VAR: Record<keyof TrustTheme, string> = {
  bg: "--tw-bg", surface: "--tw-surface", surfaceAlt: "--tw-surface-alt", line: "--tw-line",
  text: "--tw-text", textMuted: "--tw-text-muted", accent: "--tw-accent", accentText: "--tw-accent-text",
  star: "--tw-star", positive: "--tw-positive", danger: "--tw-danger",
  radius: "--tw-radius", radiusLg: "--tw-radius-lg",
  fontHeading: "--tw-font-heading", fontBody: "--tw-font-body",
  shadow: "--tw-shadow", maxWidth: "--tw-max-width",
};

export function themeToCssVars(theme: Partial<TrustTheme>): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(theme) as (keyof TrustTheme)[]).forEach((k) => {
    const v = theme[k];
    if (v) out[VAR[k]] = v;
  });
  return out;
}
