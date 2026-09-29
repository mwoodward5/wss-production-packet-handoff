import { getClient, getSitePlan } from './wss-client';
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function applyBrand() {
  const visual = record(getSitePlan()?.visual);
  const palette = record(visual.brand_palette);
  const client = getClient();
  if (!palette.primary && client.design.paletteSource !== 'donor-default' && client.design.accent) {
    palette.primary = client.design.accent;
  }
  const roles: Record<string, string[]> = {
    primary: ['--gold', '--gold-soft', '--gold-deep'], accent: ['--copper'],
    ink: ['--ink'], navy: ['--ink-2'], text: ['--bone'],
    muted: ['--muted-foreground'], glass: ['--card'], line: ['--border'],
  };
  for (const [role, variables] of Object.entries(roles)) {
    const color = palette[role];
    if (typeof color !== 'string' || color.length > 100 || /[;{}]|url|var\(/i.test(color)) continue;
    if (!/^(?:#[a-f0-9]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([^)]*\))$/i.test(color)) continue;
    if (!CSS.supports('color', color)) continue;
    for (const variable of variables) document.documentElement.style.setProperty(variable, color);
  }
}
