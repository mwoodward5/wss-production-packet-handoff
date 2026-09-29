// Frame Studio — Xavier Jordan's signature looks.
// Pure pixel-buffer functions. No external dependencies.
// All functions: applyLook(src: ImageData, intensity: 0..1) => ImageData

export type LookId =
  | "atlanta-gold-hour"
  | "buckhead-noir"
  | "ivory-linen"
  | "cinema-235"
  | "inman-park-film"
  | "dream-mode";

export interface LookDef {
  id: LookId;
  name: string;
  tagline: string;
  meta: string; // mono caption text
}

export const LOOKS: LookDef[] = [
  { id: "atlanta-gold-hour",   name: "Atlanta Gold Hour", tagline: "Warm highlights, lifted shadows, soft halation.", meta: "ATL · 35MM · ƒ/2.0" },
  { id: "buckhead-noir",       name: "Buckhead Noir",     tagline: "Silver-rich contrast, deep blacks, fine grain.",   meta: "BUC · 50MM · ƒ/1.4" },
  { id: "ivory-linen",         name: "Ivory Linen",       tagline: "Editorial wedding day. Creamy whites, muted greens.", meta: "WED · 85MM · ƒ/1.8" },
  { id: "cinema-235",          name: "Cinema 2:35",       tagline: "Teal/orange split, anamorphic glow, 2.35:1 letterbox.", meta: "CIN · 35MM · 2.35:1" },
  { id: "inman-park-film",     name: "Inman Park Film",   tagline: "Portra-leaning warmth, halation, fine dust.", meta: "INM · 50MM · 400 ISO" },
  { id: "dream-mode",          name: "Dream Mode",        tagline: "Low saturation, heavy grain, ambient bath.",   meta: "DRM · 28MM · ƒ/1.4" },
];

// ---------- low level helpers ----------
const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// hash-noise grain, deterministic per-pixel position so it doesn't shimmer per re-run
function grain(x: number, y: number, amount: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (n - Math.floor(n) - 0.5) * 2 * amount;
}

// radial vignette factor (0 at edges, 1 at center)
function vignette(x: number, y: number, w: number, h: number, strength: number) {
  const cx = w / 2, cy = h / 2;
  const dx = (x - cx) / cx;
  const dy = (y - cy) / cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  // smoothstep
  const t = Math.min(1, Math.max(0, (r - 0.55) / 0.55));
  return 1 - t * t * strength;
}

// rgb -> luma
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------- the looks ----------

interface Grade {
  // tone
  contrast: number;     // 1 = none, 1.2 = +20%
  exposure: number;     // additive in 0..255
  saturation: number;   // 1 = none
  // split tone, RGB additions per zone (0..255)
  shadowR: number; shadowG: number; shadowB: number;
  highR: number;  highG: number;  highB: number;
  // mono
  mono: boolean;
  // grain 0..50
  grainAmount: number;
  // vignette 0..1
  vignetteStrength: number;
  // halation R-channel bleed strength on bright areas (0..1)
  halation: number;
  // letterbox aspect (e.g. 2.35) or 0
  letterbox: number;
}

const GRADES: Record<LookId, Grade> = {
  "atlanta-gold-hour": {
    contrast: 1.08, exposure: 6, saturation: 1.05,
    shadowR: 8, shadowG: 4, shadowB: -6,
    highR: 18, highG: 10, highB: -8,
    mono: false, grainAmount: 6, vignetteStrength: 0.25, halation: 0.35, letterbox: 0,
  },
  "buckhead-noir": {
    contrast: 1.35, exposure: -4, saturation: 0,
    shadowR: -4, shadowG: -2, shadowB: 0,
    highR: 6, highG: 6, highB: 4,
    mono: true, grainAmount: 14, vignetteStrength: 0.45, halation: 0, letterbox: 0,
  },
  "ivory-linen": {
    contrast: 0.95, exposure: 10, saturation: 0.85,
    shadowR: 4, shadowG: 6, shadowB: 2,
    highR: 14, highG: 12, highB: 6,
    mono: false, grainAmount: 4, vignetteStrength: 0.15, halation: 0.2, letterbox: 0,
  },
  "cinema-235": {
    contrast: 1.18, exposure: -2, saturation: 1.1,
    shadowR: -10, shadowG: -2, shadowB: 14,
    highR: 16, highG: 6, highB: -10,
    mono: false, grainAmount: 8, vignetteStrength: 0.35, halation: 0.25, letterbox: 2.35,
  },
  "inman-park-film": {
    contrast: 1.05, exposure: 4, saturation: 0.95,
    shadowR: 6, shadowG: 2, shadowB: -4,
    highR: 12, highG: 8, highB: -2,
    mono: false, grainAmount: 18, vignetteStrength: 0.3, halation: 0.3, letterbox: 0,
  },
  "dream-mode": {
    contrast: 0.9, exposure: -8, saturation: 0.55,
    shadowR: -2, shadowG: 0, shadowB: 8,
    highR: 4, highG: 2, highB: -4,
    mono: false, grainAmount: 22, vignetteStrength: 0.55, halation: 0.4, letterbox: 0,
  },
};

export function applyLook(src: ImageData, lookId: LookId, intensity: number): ImageData {
  const g = GRADES[lookId];
  const t = Math.max(0, Math.min(1, intensity));
  const w = src.width, h = src.height;
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h);
  const data = out.data;

  // First pass: tone + saturation + split-tone + (mono) + grain + vignette
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = src.data[i];
      let gr = src.data[i + 1];
      let b = src.data[i + 2];

      // exposure
      r += g.exposure; gr += g.exposure; b += g.exposure;
      // contrast around 128
      r = (r - 128) * g.contrast + 128;
      gr = (gr - 128) * g.contrast + 128;
      b = (b - 128) * g.contrast + 128;
      // saturation
      const l = luma(r, gr, b);
      r = lerp(l, r, g.saturation);
      gr = lerp(l, gr, g.saturation);
      b = lerp(l, b, g.saturation);
      // split tone weights by luminance
      const lN = Math.max(0, Math.min(1, l / 255));
      const sw = 1 - lN; // shadow weight
      const hw = lN;     // highlight weight
      r += g.shadowR * sw + g.highR * hw;
      gr += g.shadowG * sw + g.highG * hw;
      b += g.shadowB * sw + g.highB * hw;
      // mono
      if (g.mono) {
        const m = luma(r, gr, b);
        r = m; gr = m; b = m;
      }
      // grain
      if (g.grainAmount > 0) {
        const n = grain(x, y, g.grainAmount);
        r += n; gr += n; b += n;
      }
      // vignette
      const v = vignette(x, y, w, h, g.vignetteStrength);
      r *= v; gr *= v; b *= v;

      // blend with original by intensity
      const or = src.data[i], og = src.data[i + 1], ob = src.data[i + 2];
      data[i]     = clamp(lerp(or, r, t));
      data[i + 1] = clamp(lerp(og, gr, t));
      data[i + 2] = clamp(lerp(ob, b, t));
      data[i + 3] = src.data[i + 3];
    }
  }

  // Halation: a cheap red-channel bloom on bright regions.
  if (g.halation > 0 && t > 0) {
    halate(data, w, h, g.halation * t);
  }

  return out;
}

function halate(data: Uint8ClampedArray, w: number, h: number, strength: number) {
  // sample brightness at coarse grid, add red+gold around it
  const step = Math.max(2, Math.floor(Math.min(w, h) / 220));
  const radius = Math.max(3, Math.floor(Math.min(w, h) / 120));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const lN = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
      if (lN < 0.78) continue;
      const boost = (lN - 0.78) * 4 * strength;
      // splat
      for (let dy = -radius; dy <= radius; dy += step) {
        for (let dx = -radius; dx <= radius; dx += step) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const d = Math.sqrt(dx * dx + dy * dy) / radius;
          if (d > 1) continue;
          const f = (1 - d) * boost * 35;
          const j = (yy * w + xx) * 4;
          data[j]     = clamp(data[j] + f * 1.0);
          data[j + 1] = clamp(data[j + 1] + f * 0.5);
          data[j + 2] = clamp(data[j + 2] + f * 0.15);
        }
      }
    }
  }
}

// returns the letterbox aspect to apply (0 = none)
export function letterboxFor(lookId: LookId): number {
  return GRADES[lookId].letterbox;
}

export function isMono(lookId: LookId): boolean {
  return GRADES[lookId].mono;
}
